import asyncio
from collections import defaultdict

from fastapi import HTTPException
from sqlmodel import select

from ..config import settings
from ..db import get_session
from ..models import Node, Sandbox, Server
from ..models.base import utc_now
from . import node_transport
from .node_gateway import node_gateway

warming = defaultdict(int)


def running_server_count(db, node_id: str) -> int:
    servers = db.exec(select(Server).where(Server.node_id == node_id, Server.deleted_at.is_(None))).all()
    return sum(server.status != "stopped" for server in servers)


def available_nodes(db, org_id: str | None = None, node_id: str | None = None):
    query = select(Node)
    if org_id is not None:
        query = query.where(Node.org_id == org_id)
    if node_id is not None:
        query = query.where(Node.id == node_id)
    return [node for node in db.exec(query.order_by(Node.name)).all() if node_gateway.is_connected(node.id)]


def require_nodes(db, org_id: str, node_id: str | None = None):
    nodes = available_nodes(db, org_id, node_id)
    if nodes:
        return nodes
    detail = "node not found or not connected" if node_id is not None else "no nodes registered"
    raise HTTPException(404, detail)


def live_sandboxes(db, node_id: str):
    return db.exec(select(Sandbox).where(Sandbox.node_id == node_id, Sandbox.deleted_at.is_(None))).all()


def warm_sandbox(db, node_id: str):
    return db.exec(
        select(Sandbox).where(
            Sandbox.node_id == node_id,
            Sandbox.deleted_at.is_(None),
            Sandbox.status == "warm",
            Sandbox.org_id.is_(None),
        )
    ).first()


def node_has_vm_capacity(db, node):
    sandboxes = live_sandboxes(db, node.id)
    local = sum(sandbox.status != "stopped" for sandbox in sandboxes)
    return local + running_server_count(db, node.id) + warming[node.id] < node.vm_count


def reserve_archive_sandbox(db, org_id: str, node_id: str | None = None, min_storage: int | None = None):
    nodes = require_nodes(db, org_id, node_id)
    if min_storage is not None:
        nodes = [node for node in nodes if node.sandbox_storage_bytes is not None and node.sandbox_storage_bytes >= min_storage]
        if not nodes:
            gigabytes = min_storage / 1024**3
            raise HTTPException(422, f"no connected node offers {gigabytes:.0f} GB of storage per sandbox")
    for node in nodes:
        warm = warm_sandbox(db, node.id)
        if warm is not None:
            warm.status = "provisioning"
            warm.org_id = org_id
            warm.created_at = utc_now()
            db.add(warm)
            db.commit()
            db.refresh(warm)
            return node, warm
    for node in nodes:
        if node_has_vm_capacity(db, node):
            return node, None
    raise HTTPException(429, "all nodes are at their configured VM capacity")


def claim_vm_for_server(org_id: str, node_id: str | None = None):
    """Claim a warm VM, or reserve capacity for a new VM."""
    with get_session() as db:
        nodes = require_nodes(db, org_id, node_id)
        for node in nodes:
            warm = warm_sandbox(db, node.id)
            if warm is not None:
                vm_id = warm.id
                warm.deleted_at = utc_now()
                db.add(warm)
                db.commit()
                db.expunge(node)
                return node, vm_id
        for node in nodes:
            if node_has_vm_capacity(db, node):
                # Reserve capacity until the provisioner finishes its create attempt.
                warming[node.id] += 1
                db.expunge(node)
                return node, None
        raise HTTPException(429, "all nodes are at their configured VM capacity")


async def ensure_node_has_warm_sandboxes(node_id: str):
    with get_session() as db:
        sandboxes = live_sandboxes(db, node_id)
        allocated = sum(sandbox.status not in ("warm", "stopped") for sandbox in sandboxes) + running_server_count(db, node_id)
        warm = sum(sandbox.status == "warm" for sandbox in sandboxes)
        node = db.get(Node, node_id)
        if node is None:
            return
        target = min(settings.warm_sandboxes_per_node, node.vm_count - allocated)

    for _ in range(max(0, target - warm - warming[node_id])):
        warming[node_id] += 1
        asyncio.create_task(warm_one(node_id))


async def reconcile_node_warm_pool(node_id: str) -> None:
    with get_session() as db:
        node = db.get(Node, node_id)
        if node is None:
            raise RuntimeError(f"node not found while reconciling capacity: {node_id}")
        sandboxes = live_sandboxes(db, node_id)
        allocated = sum(sandbox.status not in ("warm", "stopped") for sandbox in sandboxes) + running_server_count(db, node_id)
        warm = [sandbox for sandbox in sandboxes if sandbox.status == "warm"]
        target = min(settings.warm_sandboxes_per_node, max(0, node.vm_count - allocated))
        extra = warm[target:]

    for sandbox in extra:
        await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
        with get_session() as db:
            stored = db.get(Sandbox, sandbox.id)
            if stored is not None and stored.deleted_at is None:
                stored.deleted_at = utc_now()
                db.add(stored)
                db.commit()

    await ensure_node_has_warm_sandboxes(node_id)


async def warm_one(node_id: str):
    try:
        with get_session() as db:
            node = db.get(Node, node_id)
            if node is None:
                raise RuntimeError(f"node not found while warming: {node_id}")
        response = await node_transport.request(node, "POST", "/sandboxes")
        with get_session() as db:
            db.add(Sandbox(id=response.json()["id"], node_id=node_id, status="warm"))
            db.commit()
    finally:
        warming[node_id] = max(0, warming[node_id] - 1)


async def create_sandbox_on_available_node(
    org_id: str,
    status: str,
    node_id: str | None = None,
):
    for _ in range(settings.sandbox_create_wait_seconds):
        with get_session() as db:
            nodes = require_nodes(db, org_id, node_id)

            for node in nodes:
                warm = warm_sandbox(db, node.id)
                if warm is not None:
                    warm.status = status
                    warm.org_id = org_id
                    warm.created_at = utc_now()
                    db.add(warm)
                    db.commit()
                    db.refresh(warm)
                    asyncio.create_task(ensure_node_has_warm_sandboxes(node.id))
                    return node, warm

            for node in nodes:
                if node_has_vm_capacity(db, node):
                    response = await node_transport.request(node, "POST", "/sandboxes")
                    sandbox = Sandbox(id=response.json()["id"], node_id=node.id, org_id=org_id, status=status)
                    db.add(sandbox)
                    db.commit()
                    db.refresh(sandbox)
                    asyncio.create_task(ensure_node_has_warm_sandboxes(node.id))
                    return node, sandbox

            if not any(warming[node.id] for node in nodes):
                raise HTTPException(429, "all nodes are at capacity.")
        await asyncio.sleep(1)

    raise HTTPException(503, "sandboxes are still warming; try again shortly")
