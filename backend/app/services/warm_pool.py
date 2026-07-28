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


def available_nodes(db, org_id: str | None = None):
    query = select(Node)
    if org_id is not None:
        query = query.where(Node.org_id == org_id)
    return [node for node in db.exec(query.order_by(Node.name)).all() if node_gateway.is_connected(node.id)]


def node_has_vm_capacity(db, node):
    sandboxes = db.exec(select(Sandbox).where(Sandbox.node_id == node.id, Sandbox.deleted_at.is_(None))).all()
    return len(sandboxes) + warming[node.id] < settings.max_sandboxes_per_node


def require_available_node(db, org_id: str):
    nodes = available_nodes(db, org_id)
    if not nodes:
        raise HTTPException(404, "no nodes registered")
    for node in nodes:
        if node_has_vm_capacity(db, node):
            return node
    raise HTTPException(429, "all nodes are at the macOS limit of 2 VMs")


async def ensure_node_has_warm_sandboxes(node):
    db = get_session()
    sandboxes = db.exec(select(Sandbox).where(Sandbox.node_id == node.id, Sandbox.deleted_at.is_(None))).all()
    active = sum(sandbox.status == "active" for sandbox in sandboxes)
    warm = sum(sandbox.status == "warm" for sandbox in sandboxes)
    target = min(settings.warm_sandboxes_per_node, settings.max_sandboxes_per_node - active)

    for _ in range(max(0, target - warm - warming[node.id])):
        warming[node.id] += 1
        asyncio.create_task(warm_one(node))


async def warm_one(node):
    try:
        response = await node_transport.request(node, "POST", "/sandboxes")
        db = get_session()
        db.add(Sandbox(id=response.json()["id"], node_id=node.id, status="warm"))
        db.commit()
    finally:
        warming[node.id] = max(0, warming[node.id] - 1)


async def create_sandbox_on_available_node(org_id: str):
    for _ in range(settings.sandbox_create_wait_seconds):
        db = get_session()
        nodes = available_nodes(db, org_id)
        if not nodes:
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
                warm.status = "active"
                warm.org_id = org_id
                warm.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.add(warm)
                db.commit()
                db.refresh(warm)
                asyncio.create_task(ensure_node_has_warm_sandboxes(node))
                return node, warm

        for node in nodes:
            if node_has_vm_capacity(db, node):
                response = await node_transport.request(node, "POST", "/sandboxes")
                sandbox = Sandbox(id=response.json()["id"], node_id=node.id, org_id=org_id, status="active")
                db.add(sandbox)
                db.commit()
                db.refresh(sandbox)
                asyncio.create_task(ensure_node_has_warm_sandboxes(node))
                return node, sandbox

        if not any(warming[node.id] for node in nodes):
            raise HTTPException(429, "all nodes are at capacity.")
        await asyncio.sleep(1)

    raise HTTPException(503, "sandboxes are still warming; try again shortly")
