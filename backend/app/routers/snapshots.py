from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from ..auth import AuthContext, current_auth_context
from ..services import node_transport, warm_pool
from ..services.node_gateway import node_gateway
from ..db import get_session
from ..models import Node, Sandbox, Snapshot
from ..snapshot_store import blob_path, delete_manifest, read_manifest

router = APIRouter(prefix="/snapshots")


class RestoreInput(BaseModel):
    node_id: str | None = None


class SnapshotOut(BaseModel):
    id: str
    source_sandbox_id: str
    created_at: datetime
    deleted_at: datetime | None
    size_bytes: int | None


def _collect_digests(value, digests: set[str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "digest" and isinstance(item, str):
                digests.add(item)
            else:
                _collect_digests(item, digests)
    elif isinstance(value, list):
        for item in value:
            _collect_digests(item, digests)


def snapshot_size_bytes(org_id: str, snapshot_id: str) -> int | None:
    """Stored bytes: the blobs this snapshot's manifest references (shared blobs count fully)."""
    try:
        manifest = read_manifest(org_id, snapshot_id)
    except HTTPException:
        return None
    digests: set[str] = set()
    _collect_digests(manifest, digests)
    total = 0
    for digest in digests:
        try:
            total += blob_path(org_id, digest).stat().st_size
        except (OSError, HTTPException):
            continue
    return total


@router.get("")
async def list_snapshots(
    include_deleted: bool = False,
    ctx: AuthContext = Depends(current_auth_context),
) -> list[SnapshotOut]:
    org_id = ctx.membership.organization_id
    with get_session() as db:
        query = select(Snapshot).where(Snapshot.org_id == org_id)
        if not include_deleted:
            query = query.where(Snapshot.deleted_at.is_(None))
        rows = db.exec(query.order_by(Snapshot.created_at.desc())).all()
    return [
        SnapshotOut(
            id=snapshot.id,
            source_sandbox_id=snapshot.source_sandbox_id,
            created_at=snapshot.created_at,
            deleted_at=snapshot.deleted_at,
            size_bytes=None if snapshot.deleted_at else snapshot_size_bytes(org_id, snapshot.id),
        )
        for snapshot in rows
    ]


@router.post("/{snapshot_id}/restore")
async def restore_snapshot(
    snapshot_id: str,
    body: RestoreInput,
    ctx: AuthContext = Depends(current_auth_context),
) -> Sandbox:
    with get_session() as db:
        snapshot = db.get(Snapshot, snapshot_id)
        if snapshot is None or snapshot.deleted_at is not None or snapshot.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "snapshot not found")
        sandbox = db.get(Sandbox, snapshot.source_sandbox_id)
        if sandbox is None or sandbox.deleted_at is not None:
            raise HTTPException(404, "sandbox not found")
        if sandbox.status != "stopped":
            raise HTTPException(409, "sandbox is not stopped")

        if body.node_id is not None:
            node = db.get(Node, body.node_id)
            if (
                node is None
                or node.org_id != snapshot.org_id
                or not node_gateway.is_connected(node.id)
            ):
                raise HTTPException(404, "connected destination node not found")
            candidates = [node]
        else:
            candidates = warm_pool.available_nodes(db, snapshot.org_id)
            if not candidates:
                raise HTTPException(404, "no connected destination nodes")

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
            raise HTTPException(429, "all destination nodes are at capacity")

        previous_node_id = sandbox.node_id
        node_id = node.id
        manifest = read_manifest(snapshot.org_id, snapshot.id)
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
            sandbox.status = "stopped"
            db.add(sandbox)
            db.commit()
            raise

        # A restored sandbox is a fresh ephemeral one: restart its TTL clock.
        sandbox.status = "active"
        sandbox.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
        launch_config = snapshot.launch_config or sandbox.launch_config
        try:
            db.add(sandbox)
            db.commit()
        except Exception as error:
            try:
                await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
            except HTTPException as cleanup_error:
                raise HTTPException(
                    500,
                    f"restore metadata could not be saved: {error}; destination cleanup also failed: {cleanup_error.detail}",
                ) from error
            raise
        db.refresh(sandbox)
        # The disk is back but the start process died with the source VM.
        if launch_config and launch_config.get("start"):
            await node_transport.request(
                node,
                "POST",
                f"/sandboxes/{sandbox.id}/launch-config",
                json={"start": launch_config["start"]},
            )
    await warm_pool.ensure_node_has_warm_sandboxes(node_id)
    return sandbox


@router.delete("/{snapshot_id}", status_code=204)
async def delete_snapshot(snapshot_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    with get_session() as db:
        snapshot = db.get(Snapshot, snapshot_id)
        if snapshot is None or snapshot.deleted_at is not None or snapshot.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "snapshot not found")
        delete_manifest(snapshot.org_id, snapshot.id)
        # Tombstone instead of a hard delete: the row is the deletion history.
        snapshot.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(snapshot)
        db.commit()
