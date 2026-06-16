import httpx
from fastapi import APIRouter, HTTPException
from sqlmodel import select

from .. import storage, warm_pool
from ..db import get_session
from ..models import Node, Sandbox, Snapshot

router = APIRouter(prefix="/snapshots")
http = httpx.AsyncClient(timeout=None)


@router.get("")
async def list_snapshots() -> list[Snapshot]:
    db = get_session()
    return db.exec(select(Snapshot).order_by(Snapshot.created_at.desc())).all()


@router.post("/{snapshot_id}/sandboxes", status_code=201)
async def restore_snapshot(snapshot_id: str) -> Sandbox:
    db = get_session()
    snapshot = db.get(Snapshot, snapshot_id)
    node = db.exec(select(Node).order_by(Node.name)).first()
    if snapshot is None:
        raise HTTPException(404, "snapshot not found")
    if node is None:
        raise HTTPException(404, "no nodes registered")
    if not warm_pool.node_has_vm_capacity(db, node):
        raise HTTPException(429, "all nodes are at the macOS limit of 2 VMs")

    try:
        with open(storage.snapshot_path(snapshot.id), "rb") as file:
            response = await http.post(f"{node.url.rstrip('/')}/sandboxes/import", files={"archive": (f"{snapshot.id}.tgz", file)})
    except (OSError, httpx.HTTPError) as e:
        raise HTTPException(502, str(e))

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

    sandbox = Sandbox(
        id=response.json()["id"],
        node_id=node.id,
        launch_config=snapshot.launch_config,
    )
    db.add(sandbox)
    db.commit()
    db.refresh(sandbox)

    if snapshot.launch_config is not None:
        try:
            response = await http.post(f"{node.url.rstrip('/')}/sandboxes/{sandbox.id}/launch-config", json=snapshot.launch_config)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"node unreachable: {e}")
        if response.status_code >= 400:
            raise HTTPException(response.status_code, response.text)

    return sandbox


@router.delete("/{snapshot_id}", status_code=204)
async def delete_snapshot(snapshot_id: str) -> None:
    db = get_session()
    snapshot = db.get(Snapshot, snapshot_id)
    if snapshot is None:
        raise HTTPException(404, "snapshot not found")
    try:
        storage.delete_snapshot(snapshot.id)
    except FileNotFoundError:
        pass
    db.delete(snapshot)
    db.commit()
