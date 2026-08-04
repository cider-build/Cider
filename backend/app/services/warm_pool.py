import asyncio
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import select

from ..config import settings
from ..db import get_session
from ..models import Node, Sandbox, Server
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


def node_has_vm_capacity(db, node):
    sandboxes = db.exec(select(Sandbox).where(Sandbox.node_id == node.id, Sandbox.deleted_at.is_(None))).all()
    local = sum(sandbox.status != "stopped" for sandbox in sandboxes)
    return local + running_server_count(db, node.id) + warming[node.id] < node.vm_count


def require_available_node(db, org_id: str, node_id: str | None = None):
    nodes = available_nodes(db, org_id, node_id)
    if not nodes:
        if node_id is not None:
            raise HTTPException(404, "node not found or not connected")
        raise HTTPException(404, "no nodes registered")
    for node in nodes:
        if node_has_vm_capacity(db, node):
            return node
    raise HTTPException(429, "all nodes are at their configured VM capacity")


def reserve_archive_sandbox(db, org_id: str, node_id: str | None = None):
    nodes = available_nodes(db, org_id, node_id)
    if not nodes:
        if node_id is not None:
            raise HTTPException(404, "node not found or not connected")
        raise HTTPException(404, "no nodes registered")
    for node in nodes:
        warm = db.exec(
            select(Sandbox).where(
                Sandbox.node_id == node.id,
                Sandbox.deleted_at.is_(None),
                Sandbox.status == "warm",
                Sandbox.org_id.is_(None),
            )
        ).first()
        if warm is not None:
            warm.status = "provisioning"
            warm.org_id = org_id
            warm.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.add(warm)
            db.commit()
            db.refresh(warm)
            return node, warm
    for node in nodes:
        if node_has_vm_capacity(db, node):
            return node, None
    raise HTTPException(429, "all nodes are at their configured VM capacity")


def claim_vm_for_server(org_id: str, node_id: str | None = None):
    """Pick a node and, when possible, hand over a warm sandbox's already-booted VM.

    The claimed sandbox row is tombstoned — the VM lives on under the server's
    ownership. Returns (node, vm_id | None); None means the caller must cold-create.
    """
    with get_session() as db:
        nodes = available_nodes(db, org_id, node_id)
        if not nodes:
            if node_id is not None:
                raise HTTPException(404, "node not found or not connected")
            raise HTTPException(404, "no nodes registered")
        for node in nodes:
            warm = db.exec(
                select(Sandbox).where(
                    Sandbox.node_id == node.id,
                    Sandbox.deleted_at.is_(None),
                    Sandbox.status == "warm",
                    Sandbox.org_id.is_(None),
                )
            ).first()
            if warm is not None:
                warm.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.add(warm)
                db.commit()
                return node, warm.id
        for node in nodes:
            if node_has_vm_capacity(db, node):
                return node, None
        raise HTTPException(429, "all nodes are at their configured VM capacity")


async def ensure_node_has_warm_sandboxes(node_id: str):
    with get_session() as db:
        sandboxes = db.exec(select(Sandbox).where(Sandbox.node_id == node_id, Sandbox.deleted_at.is_(None))).all()
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
        sandboxes = db.exec(
            select(Sandbox).where(
                Sandbox.node_id == node_id,
                Sandbox.deleted_at.is_(None),
            )
        ).all()
        allocated = sum(sandbox.status not in ("warm", "stopped") for sandbox in sandboxes) + running_server_count(db, node_id)
        warm = [sandbox for sandbox in sandboxes if sandbox.status == "warm"]
        target = min(settings.warm_sandboxes_per_node, max(0, node.vm_count - allocated))
        extra = warm[target:]

    for sandbox in extra:
        await node_transport.request(node, "DELETE", f"/sandboxes/{sandbox.id}")
        with get_session() as db:
            stored = db.get(Sandbox, sandbox.id)
            if stored is not None and stored.deleted_at is None:
                stored.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
            nodes = available_nodes(db, org_id, node_id)
            if not nodes:
                if node_id is not None:
                    raise HTTPException(404, "node not found or not connected")
                raise HTTPException(404, "no nodes registered")

            for node in nodes:
                warm = db.exec(
                    select(Sandbox).where(
                        Sandbox.node_id == node.id,
                        Sandbox.deleted_at.is_(None),
                        Sandbox.status == "warm",
                        Sandbox.org_id.is_(None),
                    )
                ).first()
                if warm is not None:
                    warm.status = status
                    warm.org_id = org_id
                    warm.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
