from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from .. import storage
from ..auth import AuthContext, current_auth_context
from ..services import node_transport, warm_pool
from ..db import get_session
from ..models import Sandbox, Snapshot

router = APIRouter(prefix="/snapshots")


@router.get("")
async def list_snapshots(ctx: AuthContext = Depends(current_auth_context)) -> list[Snapshot]:
    db = get_session()
    return db.exec(
        select(Snapshot)
        .where(Snapshot.org_id == ctx.membership.organization_id)
        .order_by(Snapshot.created_at.desc())
    ).all()


@router.post("/{snapshot_id}/sandboxes", status_code=201)
async def restore_snapshot(snapshot_id: str, ctx: AuthContext = Depends(current_auth_context)) -> Sandbox:
    db = get_session()
    snapshot = db.get(Snapshot, snapshot_id)
    if snapshot is None or snapshot.org_id != ctx.membership.organization_id:
        raise HTTPException(404, "snapshot not found")
    node = warm_pool.require_available_node(db, ctx.membership.organization_id)

    try:
        with open(storage.snapshot_path(snapshot.id), "rb") as file:
            response = await node_transport.request(node, "POST", "/sandboxes/import", files={"archive": (f"{snapshot.id}.tgz", file)})
    except OSError as e:
        raise HTTPException(502, str(e))

    sandbox = Sandbox(
        id=response.json()["id"],
        node_id=node.id,
        org_id=ctx.membership.organization_id,
        launch_config=snapshot.launch_config,
    )
    db.add(sandbox)
    db.commit()
    db.refresh(sandbox)

    if snapshot.launch_config is not None:
        await node_transport.request(node, "POST", f"/sandboxes/{sandbox.id}/launch-config", json=snapshot.launch_config)

    return sandbox


@router.delete("/{snapshot_id}", status_code=204)
async def delete_snapshot(snapshot_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    db = get_session()
    snapshot = db.get(Snapshot, snapshot_id)
    if snapshot is None or snapshot.org_id != ctx.membership.organization_id:
        raise HTTPException(404, "snapshot not found")
    try:
        storage.delete_snapshot(snapshot.id)
    except FileNotFoundError:
        pass
    db.delete(snapshot)
    db.commit()
