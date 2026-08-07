import io
import re
import tarfile
from datetime import datetime, timedelta

import yaml
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import select

from ..auth import AuthContext, current_auth_context
from ..config import settings
from ..db import get_session
from ..models import Node, Sandbox, Snapshot
from ..models.base import utc_now
from ..services import node_transport, vm_lifecycle, warm_pool
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


class StorageUsage(BaseModel):
    used_bytes: int


def with_node(sandbox: Sandbox, node: Node) -> SandboxWithNode:
    return SandboxWithNode(**sandbox.model_dump(), node_name=node.name)


def owned_sandbox(db, sandbox_id: str, org_id: str) -> Sandbox:
    sandbox = db.get(Sandbox, sandbox_id)
    if sandbox is None or sandbox.deleted_at is not None or sandbox.org_id != org_id:
        raise HTTPException(404, "sandbox not found")
    return sandbox


def sandbox_node(db, sandbox: Sandbox) -> Node:
    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")
    return node


async def cleanup_expired_sandboxes() -> None:
    db = get_session()
    try:
        cutoff = utc_now() - timedelta(seconds=settings.sandbox_ttl_seconds)
        nodes_to_refill = []
        for sandbox in db.exec(select(Sandbox).where(Sandbox.deleted_at.is_(None), Sandbox.status == "active", Sandbox.created_at <= cutoff)).all():
            node = db.get(Node, sandbox.node_id)
            if node is None:
                continue
            try:
                await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
            except HTTPException:
                continue
            sandbox.deleted_at = utc_now()
            db.add(sandbox)
            nodes_to_refill.append(node.id)
        db.commit()
    finally:
        db.close()
    for node_id in nodes_to_refill:
        await warm_pool.ensure_node_has_warm_sandboxes(node_id)


CONFIG_NAMES = ("cider.yaml", "cider.yml")


def extract_launch_config(archive: bytes) -> dict | None:
    found: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = member.name.removeprefix("./").split("/")
            if len(parts) <= 2 and parts[-1] in CONFIG_NAMES and member.isfile():
                file = tar.extractfile(member)
                if file is not None:
                    found.setdefault(parts[-1], file.read())
    for name in CONFIG_NAMES:
        if name not in found:
            continue
        try:
            config = yaml.safe_load(found[name])
        except yaml.YAMLError as error:
            raise ValueError(f"{name} could not be parsed: {error}") from error
        if not isinstance(config, dict):
            raise ValueError(f"{name} must be a mapping")
        return config
    return None


STORAGE_UNITS = {"kb": 1024, "mb": 1024**2, "gb": 1024**3, "tb": 1024**4}


def min_storage_bytes(config: dict | None) -> int | None:
    if not config:
        return None
    resources = config.get("resources")
    if not isinstance(resources, dict) or "min_storage" not in resources:
        return None
    value = resources["min_storage"]
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str):
        match = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*(kb|mb|gb|tb)\s*", value, re.IGNORECASE)
        if match:
            return int(float(match.group(1)) * STORAGE_UNITS[match.group(2).lower()])
    raise ValueError('resources.min_storage must be bytes or a size like "60GB"')


@router.get("")
async def list_sandboxes(ctx: AuthContext = Depends(current_auth_context)) -> list[SandboxWithNode]:
    with get_session() as db:
        rows = db.exec(
            select(Sandbox, Node)
            .join(Node, Sandbox.node_id == Node.id)
            .where(Sandbox.org_id == ctx.membership.organization_id)
            .order_by(Sandbox.created_at.desc())
        ).all()
    return [with_node(sandbox, node) for sandbox, node in rows]


@router.get("/{sandbox_id}")
async def get_sandbox(sandbox_id: str, ctx: AuthContext = Depends(current_auth_context)) -> SandboxWithNode:
    with get_session() as db:
        sandbox = db.get(Sandbox, sandbox_id)
        if sandbox is None or sandbox.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "sandbox not found")
        node = sandbox_node(db, sandbox)
    return with_node(sandbox, node)


@router.get("/{sandbox_id}/storage-usage")
async def get_sandbox_storage_usage(
    sandbox_id: str,
    ctx: AuthContext = Depends(current_auth_context),
) -> StorageUsage:
    with get_session() as db:
        sandbox = owned_sandbox(db, sandbox_id, ctx.membership.organization_id)
        if sandbox.status != "active":
            raise HTTPException(409, "storage usage requires a running sandbox")
        node = sandbox_node(db, sandbox)
    response = await node_transport.request(node, "GET", f"/sandboxes/{sandbox.id}/storage-usage")
    return StorageUsage.model_validate(response.json())


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
                    min_storage=min_storage_bytes(config),
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
                        sandbox.deleted_at = utc_now()
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
        sandbox = owned_sandbox(db, sandbox_id, ctx.membership.organization_id)
        if sandbox.status != "active":
            raise HTTPException(409, "snapshots require a running sandbox")
        node = sandbox_node(db, sandbox)
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
        sandbox = owned_sandbox(db, sandbox_id, ctx.membership.organization_id)
        if sandbox.status in ("stopped", "restoring"):
            raise HTTPException(409, f"sandbox is {sandbox.status}; wait for it to be available")
        node = sandbox_node(db, sandbox)

    response = await node_transport.request(node, "POST", f"/sandboxes/{sandbox.id}/execute", json={"command": body.command})

    return response.json()


@router.delete("/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    with get_session() as db:
        sandbox = owned_sandbox(db, sandbox_id, ctx.membership.organization_id)
        node = db.get(Node, sandbox.node_id)
        node_id = node.id if node is not None else None
        holds_vm = sandbox.status not in ("stopped", "paused")
        should_refill = holds_vm
        if holds_vm:
            if node is None:
                raise HTTPException(404, "node not found")
            await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
        if sandbox.status == "paused":
            discard_manifest(sandbox.org_id, pause_key(sandbox.id))

        sandbox.deleted_at = utc_now()
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
    with get_session() as db:
        sandbox = owned_sandbox(db, sandbox_id, ctx.membership.organization_id)
        if sandbox.status != "active":
            raise HTTPException(409, f"sandbox is {sandbox.status}; only a running sandbox can be paused")
        node = sandbox_node(db, sandbox)
        node_id = node.id

        # Prevent reconciliation from treating the VM removal as drift.
        sandbox.status = "pausing"
        db.add(sandbox)
        db.commit()
        try:
            await vm_lifecycle.export_vm(node, sandbox.id, sandbox.org_id, pause_key(sandbox.id))
        except BaseException:
            sandbox.status = "active"
            db.add(sandbox)
            db.commit()
            raise
        sandbox.status = "paused"
        db.add(sandbox)
        db.commit()
        db.refresh(sandbox)
    await warm_pool.ensure_node_has_warm_sandboxes(node_id)
    return sandbox


@router.post("/{sandbox_id}/resume", status_code=200)
async def resume_sandbox(
    sandbox_id: str,
    body: ResumeInput | None = None,
    ctx: AuthContext = Depends(current_auth_context),
) -> Sandbox:
    requested_node_id = body.node_id if body else None
    with get_session() as db:
        sandbox = owned_sandbox(db, sandbox_id, ctx.membership.organization_id)
        if sandbox.status != "paused":
            raise HTTPException(409, f"sandbox is {sandbox.status}; only a paused sandbox can be resumed")

        node = await vm_lifecycle.find_capacity_node(db, sandbox.org_id, requested_node_id)

        previous_node_id = sandbox.node_id
        node_id = node.id
        sandbox.node_id = node.id
        sandbox.status = "restoring"
        db.add(sandbox)
        db.commit()
        try:
            await vm_lifecycle.restore_vm(node, sandbox.id, sandbox.org_id, pause_key(sandbox.id))
        except BaseException:
            sandbox.node_id = previous_node_id
            sandbox.status = "paused"
            db.add(sandbox)
            db.commit()
            raise

        sandbox.status = "active"
        sandbox.created_at = utc_now()
        db.add(sandbox)
        db.commit()
        db.refresh(sandbox)
        # Restore preserves disk changes, but not running processes.
        if sandbox.launch_config:
            await vm_lifecycle.run_launch(node, sandbox.id, start=sandbox.launch_config.get("start"))
    discard_manifest(sandbox.org_id, pause_key(sandbox.id))
    await warm_pool.ensure_node_has_warm_sandboxes(node_id)
    return sandbox
