import asyncio
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import select

from ..config import settings
from ..db import get_session
from ..models import Node, Sandbox
from . import node_transport
from .node_gateway import node_gateway

warming = defaultdict(int)


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
    return local + warming[node.id] < settings.max_sandboxes_per_node


def require_available_node(db, org_id: str, node_id: str | None = None):
    nodes = available_nodes(db, org_id, node_id)
    if not nodes:
        if node_id is not None:
            raise HTTPException(404, "node not found or not connected")
        raise HTTPException(404, "no nodes registered")
    for node in nodes:
        if node_has_vm_capacity(db, node):
            return node
    raise HTTPException(429, "all nodes are at the macOS limit of 2 VMs")


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
    raise HTTPException(429, "all nodes are at the macOS limit of 2 VMs")


async def ensure_node_has_warm_sandboxes(node_id: str):
    with get_session() as db:
        sandboxes = db.exec(select(Sandbox).where(Sandbox.node_id == node_id, Sandbox.deleted_at.is_(None))).all()
        allocated = sum(sandbox.status not in ("warm", "stopped") for sandbox in sandboxes)
        warm = sum(sandbox.status == "warm" for sandbox in sandboxes)
        target = min(settings.warm_sandboxes_per_node, settings.max_sandboxes_per_node - allocated)

    for _ in range(max(0, target - warm - warming[node_id])):
        warming[node_id] += 1
        asyncio.create_task(warm_one(node_id))


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
