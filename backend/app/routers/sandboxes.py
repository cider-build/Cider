from datetime import datetime, timedelta, timezone
import io
import json
import tarfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import select

from ..auth import AuthContext, current_auth_context
from ..config import settings
from ..services import node_transport, warm_pool
from ..db import get_session
from ..models import Node, Sandbox, Snapshot
from ..snapshot_store import discard_manifest, write_manifest

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
    try:
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
            nodes_to_refill.append(node.id)
        db.commit()
    finally:
        db.close()
    for node_id in nodes_to_refill:
        await warm_pool.ensure_node_has_warm_sandboxes(node_id)


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
    with get_session() as db:
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
    persistent: bool = Form(False),
    node_id: str | None = Form(None),
    ctx: AuthContext = Depends(current_auth_context),
) -> Sandbox:
    config = None
    status = "persistent" if persistent else "active"

    with get_session() as db:
        try:
            if archive is None:
                node, sandbox = await warm_pool.create_sandbox_on_available_node(
                    ctx.membership.organization_id,
                    status,
                    node_id,
                )
            else:
                node = warm_pool.require_available_node(
                    db,
                    ctx.membership.organization_id,
                    node_id,
                )
                archive_bytes = await archive.read()
                config = extract_launch_config(archive_bytes)
                response = await node_transport.request(
                    node,
                    "POST",
                    "/sandboxes",
                    files={"archive": (archive.filename, archive_bytes, archive.content_type)},
                )
                sandbox = Sandbox(id=response.json()["id"], node_id=node.id, org_id=ctx.membership.organization_id, launch_config=config, status=status)
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
    with get_session() as db:
        sandbox = db.get(Sandbox, sandbox_id)
        if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "sandbox not found")
        # Automatic TTL cleanup makes ephemeral sandboxes unsuitable for durable snapshots.
        if sandbox.status != "persistent":
            raise HTTPException(409, "snapshots require a persistent sandbox")

        node = db.get(Node, sandbox.node_id)
        if node is None:
            raise HTTPException(404, "node not found")
        node_id = node.id

        snapshot = Snapshot(source_sandbox_id=sandbox.id, org_id=ctx.membership.organization_id, launch_config=sandbox.launch_config)
        response = await node_transport.request(
            node,
            "POST",
            f"/sandboxes/{sandbox.id}/portable-snapshots",
            json={"snapshot": snapshot.id},
        )
        manifest = response.json()["manifest"]

        try:
            write_manifest(snapshot.org_id, snapshot.id, manifest)
            db.add(snapshot)
            sandbox.status = "stopped"
            db.add(sandbox)
            db.commit()
        except Exception as error:
            discard_manifest(snapshot.org_id, snapshot.id)
            raise HTTPException(500, f"snapshot metadata could not be saved: {error}") from error
        db.refresh(snapshot)
        try:
            await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
        except HTTPException as error:
            raise HTTPException(
                500,
                f"snapshot was saved, but removing its stopped source VM failed: {error.detail}",
            ) from error
    await warm_pool.ensure_node_has_warm_sandboxes(node_id)
    return snapshot


@router.post("/{sandbox_id}/execute", status_code=200)
async def execute_sandbox(sandbox_id: str, body: ExecuteInput, ctx: AuthContext = Depends(current_auth_context)) -> dict:
    with get_session() as db:
        sandbox = db.get(Sandbox, sandbox_id)
        if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "sandbox not found")
        if sandbox.status in ("stopped", "restoring"):
            raise HTTPException(409, f"sandbox is {sandbox.status}; wait for it to be available")

        node = db.get(Node, sandbox.node_id)
        if node is None:
            raise HTTPException(404, "node not found")

    response = await node_transport.request(node, "POST", f"/sandboxes/{sandbox.id}/execute", json={"command": body.command})

    return response.json()


@router.delete("/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    with get_session() as db:
        sandbox = db.get(Sandbox, sandbox_id)

        if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "sandbox not found")

        node = db.get(Node, sandbox.node_id)
        node_id = node.id if node is not None else None
        should_refill = sandbox.status != "stopped"
        if sandbox.status != "stopped":
            if node is None:
                raise HTTPException(404, "node not found")
            await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")

        sandbox.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(sandbox)
        db.commit()
    if should_refill:
        await warm_pool.ensure_node_has_warm_sandboxes(node_id)
