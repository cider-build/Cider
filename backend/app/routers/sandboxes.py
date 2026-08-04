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
from ..services.node_gateway import node_gateway
from ..db import get_session
from ..models import Node, Sandbox, Snapshot
import uuid

from ..snapshot_store import discard_manifest, read_manifest, write_manifest

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
    node_id: str | None = Form(None),
    ctx: AuthContext = Depends(current_auth_context),
) -> Sandbox:
    config = None
    status = "active"

    with get_session() as db:
        try:
            if archive is None:
                node, sandbox = await warm_pool.create_sandbox_on_available_node(
                    ctx.membership.organization_id,
                    status,
                    node_id,
                )
            else:
                archive_bytes = await archive.read()
                config = extract_launch_config(archive_bytes)
                node, sandbox = warm_pool.reserve_archive_sandbox(
                    db,
                    ctx.membership.organization_id,
                    node_id,
                )
                if sandbox is None:
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
                else:
                    try:
                        await node_transport.request(
                            node,
                            "POST",
                            f"/sandboxes/{sandbox.id}/upload",
                            files={"archive": (archive.filename, archive_bytes, archive.content_type)},
                        )
                    except HTTPException as error:
                        try:
                            await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
                        except HTTPException as cleanup_error:
                            raise HTTPException(
                                500,
                                f"warm sandbox upload failed: {error.detail}; cleanup also failed: {cleanup_error.detail}",
                            ) from error
                        sandbox.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
                        db.add(sandbox)
                        db.commit()
                        await warm_pool.ensure_node_has_warm_sandboxes(node.id)
                        raise
                    sandbox.status = status
                    sandbox.launch_config = config
                    db.add(sandbox)
                    db.commit()
                    db.refresh(sandbox)
                    await warm_pool.ensure_node_has_warm_sandboxes(node.id)
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
        if sandbox.status != "active":
            raise HTTPException(409, "snapshots require a running sandbox")

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
        # stopped and paused sandboxes hold no VM; their state is in Cider storage.
        holds_vm = sandbox.status not in ("stopped", "paused")
        should_refill = holds_vm
        if holds_vm:
            if node is None:
                raise HTTPException(404, "node not found")
            await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
        if sandbox.status == "paused":
            discard_manifest(sandbox.org_id, pause_key(sandbox.id))

        sandbox.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(sandbox)
        db.commit()
    if should_refill:
        await warm_pool.ensure_node_has_warm_sandboxes(node_id)


def pause_key(sandbox_id: str) -> str:
    return f"pause-{sandbox_id}"


class ResumeInput(BaseModel):
    node_id: str | None = None


@router.post("/{sandbox_id}/pause", status_code=200)
async def pause_sandbox(sandbox_id: str, ctx: AuthContext = Depends(current_auth_context)) -> Sandbox:
    """Snapshot the VM into Cider storage, then destroy it. Frees the node's slot."""
    with get_session() as db:
        sandbox = db.get(Sandbox, sandbox_id)
        if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "sandbox not found")
        if sandbox.status != "active":
            raise HTTPException(409, f"sandbox is {sandbox.status}; only a running sandbox can be paused")
        node = db.get(Node, sandbox.node_id)
        if node is None:
            raise HTTPException(404, "node not found")
        node_id = node.id

        response = await node_transport.request(
            node,
            "POST",
            f"/sandboxes/{sandbox.id}/portable-snapshots",
            json={"snapshot": uuid.uuid4().hex},
        )
        manifest = response.json()["manifest"]
        try:
            write_manifest(sandbox.org_id, pause_key(sandbox.id), manifest)
            sandbox.status = "paused"
            db.add(sandbox)
            db.commit()
        except Exception as error:
            discard_manifest(sandbox.org_id, pause_key(sandbox.id))
            raise HTTPException(500, f"pause state could not be saved: {error}") from error
        db.refresh(sandbox)
        try:
            await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
        except HTTPException as error:
            raise HTTPException(
                500,
                f"sandbox was paused, but removing its stopped VM failed: {error.detail}",
            ) from error
    await warm_pool.ensure_node_has_warm_sandboxes(node_id)
    return sandbox


@router.post("/{sandbox_id}/resume", status_code=200)
async def resume_sandbox(
    sandbox_id: str,
    body: ResumeInput | None = None,
    ctx: AuthContext = Depends(current_auth_context),
) -> Sandbox:
    """Restore a paused sandbox onto any connected node with a free slot — sandboxes are portable."""
    requested_node_id = body.node_id if body else None
    with get_session() as db:
        sandbox = db.get(Sandbox, sandbox_id)
        if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "sandbox not found")
        if sandbox.status != "paused":
            raise HTTPException(409, f"sandbox is {sandbox.status}; only a paused sandbox can be resumed")

        if requested_node_id is not None:
            node = db.get(Node, requested_node_id)
            if node is None or node.org_id != sandbox.org_id or not node_gateway.is_connected(node.id):
                raise HTTPException(404, "connected destination node not found")
            candidates = [node]
        else:
            candidates = warm_pool.available_nodes(db, sandbox.org_id)
            if not candidates:
                raise HTTPException(404, "no connected nodes")

        node = None
        for candidate in candidates:
            if warm_pool.node_has_vm_capacity(db, candidate):
                node = candidate
                break
            warm = db.exec(
                select(Sandbox).where(
                    Sandbox.node_id == candidate.id,
                    Sandbox.deleted_at.is_(None),
                    Sandbox.status == "warm",
                )
            ).first()
            if warm is not None:
                await node_transport.request(candidate, "DELETE", f"/sandboxes/{warm.id}")
                warm.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.add(warm)
                db.commit()
                node = candidate
                break
        if node is None:
            raise HTTPException(429, "every connected node is at its VM capacity; stop something first")

        previous_node_id = sandbox.node_id
        node_id = node.id
        manifest = read_manifest(sandbox.org_id, pause_key(sandbox.id))
        sandbox.node_id = node.id
        sandbox.status = "restoring"
        db.add(sandbox)
        db.commit()
        try:
            await node_transport.request(
                node,
                "POST",
                f"/sandboxes/{sandbox.id}/restore",
                json={"manifest": manifest},
            )
        except BaseException:
            sandbox.node_id = previous_node_id
            sandbox.status = "paused"
            db.add(sandbox)
            db.commit()
            raise

        # A resumed sandbox restarts its TTL clock, like a restored one.
        sandbox.status = "active"
        sandbox.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(sandbox)
        db.commit()
        db.refresh(sandbox)
    discard_manifest(sandbox.org_id, pause_key(sandbox.id))
    await warm_pool.ensure_node_has_warm_sandboxes(node_id)
    return sandbox
