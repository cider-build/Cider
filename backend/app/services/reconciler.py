"""Constant-work reconciliation: the node is the source of truth for VM state.

Every sweep asks each connected node for a full snapshot of its VMs (same
request whether nothing changed or everything did) and corrects the backend's
rows to match. The database is a cached view; the Mac that runs the VM is the
only thing that cannot be wrong about it.

A wrong write that races a user action (stop/start landing between the VM
fetch and the row update) self-corrects on the next sweep.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlmodel import select

from ..db import get_session
from ..models import Node, Sandbox, Server
from . import node_transport, warm_pool
from .node_gateway import node_gateway

# Rows younger than this are skipped: their VM may legitimately not exist yet
# (async server provision, snapshot restore mid-flight).
GRACE = timedelta(seconds=180)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def reconcile_all_nodes() -> None:
    with get_session() as db:
        node_ids = [node.id for node in db.exec(select(Node)).all()]
    for node_id in node_ids:
        if not node_gateway.is_connected(node_id):
            continue
        if warm_pool.warming[node_id] > 0:
            # Warm VMs are mid-boot; a snapshot now would look like drift.
            continue
        try:
            await reconcile_node(node_id)
        except Exception:
            # One bad node must not stop the sweep; next pass retries it.
            continue


async def reconcile_node(node_id: str) -> None:
    with get_session() as db:
        node = db.get(Node, node_id)
    if node is None:
        return
    try:
        response = await node_transport.request(node, "GET", "/sandboxes")
    except HTTPException:
        return
    vm_status = {vm["id"]: vm["status"] for vm in response.json()}

    cutoff = _now() - GRACE
    refill = False
    with get_session() as db:
        servers = db.exec(
            select(Server).where(Server.node_id == node_id, Server.deleted_at.is_(None))
        ).all()
        for server in servers:
            # provisioning/failed are backend-owned states; running/stopped mirror the VM.
            if server.status not in ("running", "stopped") or not server.vm_id:
                continue
            if server.created_at > cutoff:
                continue
            state = vm_status.get(server.vm_id)
            if state is None:
                # The VM (and its disk) is gone from the node.
                server.status = "failed"
            elif state == "running" and server.status == "stopped":
                server.status = "running"
            elif state != "running" and server.status == "running":
                server.status = "stopped"
            else:
                continue
            db.add(server)

        sandboxes = db.exec(
            select(Sandbox).where(
                Sandbox.node_id == node_id,
                Sandbox.deleted_at.is_(None),
                # stopped sandboxes hold no VM by design; restoring is mid-flight.
                Sandbox.status.in_(("active", "warm")),
            )
        ).all()
        for sandbox in sandboxes:
            if sandbox.created_at > cutoff:
                continue
            if sandbox.id not in vm_status:
                sandbox.deleted_at = _now()
                db.add(sandbox)
                refill = True
        db.commit()
    if refill:
        await warm_pool.ensure_node_has_warm_sandboxes(node_id)
