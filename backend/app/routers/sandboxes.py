from datetime import datetime, timedelta, timezone
import io
import json
import tarfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import select

from .. import storage
from ..auth import AuthContext, current_auth_context
from ..config import settings
from ..services import node_transport, warm_pool
from ..db import get_session
from ..models import Node, Sandbox, Snapshot

router = APIRouter(prefix="/sandboxes")


class ExecuteInput(BaseModel):
    command: str


class SandboxWithNode(BaseModel):
    id: str
    node_id: str
    node_name: str
    status: str
    created_at: datetime
    deleted_at: datetime | None


async def cleanup_expired_sandboxes() -> None:
    db = get_session()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=settings.sandbox_ttl_seconds)
    nodes_to_refill = []
    for sandbox in db.exec(select(Sandbox).where(Sandbox.deleted_at.is_(None), Sandbox.status == "active", Sandbox.created_at <= cutoff)).all():
        node = db.get(Node, sandbox.node_id)
        if node is None:
            continue
        try:
            await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
        except HTTPException:
            continue
        sandbox.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(sandbox)
        nodes_to_refill.append(node)
    db.commit()
    for node in nodes_to_refill:
        await warm_pool.ensure_node_has_warm_sandboxes(node)


def extract_launch_config(archive: bytes) -> dict | None:
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = member.name.removeprefix("./").split("/")
            if len(parts) <= 2 and parts[-1] == "cider.json" and member.isfile():
                file = tar.extractfile(member)
                if file is None:
                    return None
                config = json.load(file)
                if not isinstance(config, dict):
                    raise ValueError("cider.json must be a JSON object")
                return config
    return None


@router.get("")
async def list_sandboxes(ctx: AuthContext = Depends(current_auth_context)) -> list[SandboxWithNode]:
    db = get_session()
    rows = db.exec(
        select(Sandbox, Node)
        .join(Node, Sandbox.node_id == Node.id)
        .where(Sandbox.org_id == ctx.membership.organization_id)
        .order_by(Sandbox.created_at.desc())
    ).all()
    return [SandboxWithNode(**sandbox.model_dump(), node_name=node.name) for sandbox, node in rows]


@router.post("", status_code=201)
async def create_sandbox(
    archive: UploadFile | None = File(None),
    ctx: AuthContext = Depends(current_auth_context),
) -> Sandbox:
    db = get_session()
    config = None

    try:
        if archive is None:
            node, sandbox = await warm_pool.create_sandbox_on_available_node(ctx.membership.organization_id)
        else:
            node = warm_pool.require_available_node(db, ctx.membership.organization_id)
            archive_bytes = await archive.read()
            config = extract_launch_config(archive_bytes)
            response = await node_transport.request(
                node,
                "POST",
                "/sandboxes",
                files={"archive": (archive.filename, archive_bytes, archive.content_type)},
            )
            sandbox = Sandbox(id=response.json()["id"], node_id=node.id, org_id=ctx.membership.organization_id, launch_config=config)
            db.add(sandbox)
            db.commit()
            db.refresh(sandbox)
    except ValueError as e:
        raise HTTPException(422, str(e))

    if config is not None:
        await node_transport.request(node, "POST", f"/sandboxes/{sandbox.id}/launch-config", json=config)

    return sandbox


@router.post("/{sandbox_id}/snapshots", status_code=201)
async def snapshot_sandbox(sandbox_id: str, ctx: AuthContext = Depends(current_auth_context)) -> Snapshot:
    db = get_session()
    sandbox = db.get(Sandbox, sandbox_id)
    if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")

    snapshot = Snapshot(source_sandbox_id=sandbox.id, org_id=ctx.membership.organization_id, launch_config=sandbox.launch_config)
    response = await node_transport.request(node, "POST", f"/sandboxes/{sandbox.id}/export")
    await storage.save_snapshot(snapshot.id, response.aiter_bytes())

    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


@router.post("/{sandbox_id}/execute", status_code=200)
async def execute_sandbox(sandbox_id: str, body: ExecuteInput, ctx: AuthContext = Depends(current_auth_context)) -> dict:
    db = get_session()
    sandbox = db.get(Sandbox, sandbox_id)
    if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")

    response = await node_transport.request(node, "POST", f"/sandboxes/{sandbox.id}/execute", json={"command": body.command})

    return response.json()


@router.delete("/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    db = get_session()
    sandbox = db.get(Sandbox, sandbox_id)

    if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")

    await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")

    sandbox.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(sandbox)
    db.commit()
    await warm_pool.ensure_node_has_warm_sandboxes(node)
