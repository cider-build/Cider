"""Reconcile database workload state with each connected node."""

import logging
from datetime import timedelta

from fastapi import HTTPException
from sqlmodel import select

from ..db import get_session
from ..models import Node, Sandbox, Server
from ..models.base import utc_now
from . import inflight, node_transport, storage_usage, warm_pool
from .node_gateway import node_gateway

logger = logging.getLogger(__name__)

# Ignore rows while asynchronous provisioning or restoration can remain active.
GRACE = timedelta(seconds=180)
MOVING = {"provisioning", "stopping"}


async def reconcile_all_nodes() -> None:
    with get_session() as db:
        node_ids = [node.id for node in db.exec(select(Node)).all()]
    for node_id in node_ids:
        if not node_gateway.is_connected(node_id):
            continue
        if warm_pool.warming[node_id] > 0:
            # Skip partial node state during warm VM creation.
            continue
        try:
            await reconcile_node(node_id)
        except Exception:
            # Retry failed nodes during the next sweep.
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

    cutoff = utc_now() - GRACE
    refill = False
    with get_session() as db:
        servers = db.exec(
            select(Server).where(Server.node_id == node_id, Server.deleted_at.is_(None))
        ).all()
        for server in servers:
            repair_legacy_failure = server.status == "failed" and server.status_detail is None
            stranded = server.status in MOVING and not inflight.is_active(server.id)
            if server.status != "running" and not repair_legacy_failure and not stranded:
                continue
            if not server.vm_id and not stranded:
                continue
            if server.created_at > cutoff:
                continue
            state = vm_status.get(server.vm_id)
            if state == "running":
                if repair_legacy_failure or stranded:
                    server.status = "running"
                    server.status_detail = None
                    db.add(server)
                continue
            previous_status = server.status
            if stranded:
                logger.info(
                    "Server %s was %s, but its node reports %s",
                    server.id,
                    previous_status,
                    state,
                )
            if state == "stopped":
                server.status = "stopped"
                server.status_detail = "The node stopped this VM. Start the server to resume it."
            elif stranded and state is None:
                server.status = "failed"
                server.status_detail = (
                    "Provisioning stopped when the backend restarted, and the node has no VM "
                    "for this server. Retry to build it again."
                    if previous_status == "provisioning"
                    else "Stopping did not finish and the node has no VM for this server."
                )
            else:
                server.status = "failed"
                server.status_detail = (
                    "The node no longer has this VM."
                    if state is None
                    else f"The node reports VM state: {state}."
                )
            db.add(server)

        sandboxes = db.exec(
            select(Sandbox).where(Sandbox.node_id == node_id, Sandbox.deleted_at.is_(None))
        ).all()
        for sandbox in sandboxes:
            if sandbox.status not in ("active", "warm"):
                continue
            if sandbox.created_at > cutoff:
                continue
            if sandbox.id not in vm_status:
                sandbox.deleted_at = utc_now()
                db.add(sandbox)
                refill = True
        db.commit()

    # Delete VMs left by failures between VM creation and row commit.
    claimed = {sandbox.id for sandbox in sandboxes if sandbox.deleted_at is None}
    claimed |= {server.vm_id for server in servers if server.vm_id}
    orphans = [vm_id for vm_id in vm_status if vm_id not in claimed]
    for vm_id in orphans:
        try:
            await node_transport.request(node, "DELETE", f"/sandboxes/{vm_id}")
        except HTTPException:
            continue
        refill = True
    if refill:
        await warm_pool.ensure_node_has_warm_sandboxes(node_id)

    # Backfill measurements for running rows that have none recorded.
    targets: list[tuple[type, str, str]] = []
    with get_session() as db:
        for model, status, vm_attr in ((Server, "running", "vm_id"), (Sandbox, "active", "id")):
            rows = db.exec(
                select(model).where(
                    model.node_id == node_id,
                    model.deleted_at.is_(None),
                    model.status == status,
                    model.storage_used_bytes.is_(None),
                )
            ).all()
            targets += [
                (model, row.id, getattr(row, vm_attr))
                for row in rows
                if vm_status.get(getattr(row, vm_attr)) == "running"
            ]

    for model, row_id, vm_id in targets:
        try:
            used_bytes = await storage_usage.measure_vm_storage(node, vm_id)
        except HTTPException:
            # An unreachable VM must not abort the sweep for the other rows.
            continue
        storage_usage.record(model, row_id, used_bytes)
