import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlmodel import select
from typing import Annotated

from ..auth import AuthContext, current_auth_context
from ..db import get_session
from ..models import Node, Server
from ..services import node_transport, warm_pool

router = APIRouter(prefix="/servers")

ServerName = Annotated[str, StringConstraints(min_length=1, max_length=63, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$")]


class ServerImage(BaseModel):
    os: str
    variant: str
    software: list[str] = []
    openclaw_channels: list[str] = []


class CreateServerInput(BaseModel):
    name: ServerName
    node_id: str | None = None
    image: ServerImage | None = None


class ServerWithNode(BaseModel):
    id: str
    name: str
    node_id: str
    node_name: str
    status: str
    image: dict | None
    created_at: datetime
    deleted_at: datetime | None


def with_node(server: Server, node: Node) -> ServerWithNode:
    return ServerWithNode(**server.model_dump(), node_name=node.name)


def owned_server(db, server_id: str, org_id: str) -> tuple[Server, Node]:
    server = db.get(Server, server_id)
    if server is None or server.deleted_at is not None or server.org_id != org_id:
        raise HTTPException(404, "server not found")
    node = db.get(Node, server.node_id)
    if node is None:
        raise HTTPException(404, "node not found")
    return server, node


@router.get("")
async def list_servers(
    include_deleted: bool = False,
    ctx: AuthContext = Depends(current_auth_context),
) -> list[ServerWithNode]:
    with get_session() as db:
        query = (
            select(Server, Node)
            .join(Node, Server.node_id == Node.id)
            .where(Server.org_id == ctx.membership.organization_id)
        )
        if not include_deleted:
            query = query.where(Server.deleted_at.is_(None))
        rows = db.exec(query.order_by(Server.created_at.desc())).all()
    return [with_node(server, node) for server, node in rows]


@router.post("", status_code=201)
async def create_server(body: CreateServerInput, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    org_id = ctx.membership.organization_id
    with get_session() as db:
        duplicate = db.exec(
            select(Server).where(
                Server.org_id == org_id,
                Server.name == body.name,
                Server.deleted_at.is_(None),
            )
        ).first()
        if duplicate is not None:
            raise HTTPException(409, f"a server named {body.name!r} already exists")

    # Claiming a warm sandbox gives an already-booted VM; the warm pool refills behind it.
    node, vm_id = warm_pool.claim_vm_for_server(org_id, body.node_id)

    with get_session() as db:
        server = Server(
            org_id=org_id,
            node_id=node.id,
            name=body.name,
            vm_id=vm_id or "",
            image=body.image.model_dump() if body.image else None,
            status="running" if vm_id else "provisioning",
        )
        db.add(server)
        db.commit()
        db.refresh(server)
    if vm_id is None:
        # Cold path: booting a fresh VM takes a while, so it happens behind the row.
        asyncio.create_task(provision_server(server.id, node.id))
    asyncio.create_task(warm_pool.ensure_node_has_warm_sandboxes(node.id))
    return with_node(server, node)


async def provision_server(server_id: str, node_id: str) -> None:
    with get_session() as db:
        node = db.get(Node, node_id)
    if node is None:
        return
    try:
        response = await node_transport.request(node, "POST", "/sandboxes")
        vm_id = response.json()["id"]
    except Exception:
        with get_session() as db:
            server = db.get(Server, server_id)
            if server is not None and server.deleted_at is None:
                server.status = "failed"
                db.add(server)
                db.commit()
        return
    with get_session() as db:
        server = db.get(Server, server_id)
        deleted_meanwhile = server is None or server.deleted_at is not None
        if not deleted_meanwhile:
            server.vm_id = vm_id
            server.status = "running"
            db.add(server)
            db.commit()
    if deleted_meanwhile:
        try:
            await node_transport.request(node, "DELETE", f"/sandboxes/{vm_id}")
        except HTTPException:
            pass


@router.get("/{server_id}")
async def get_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
    return with_node(server, node)


@router.post("/{server_id}/stop")
async def stop_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        if server.status == "stopped":
            return with_node(server, node)
        if server.status != "running":
            raise HTTPException(409, f"server is {server.status}; it cannot be stopped")
    await node_transport.request(node, "POST", f"/sandboxes/{server.vm_id}/stop")
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        server.status = "stopped"
        db.add(server)
        db.commit()
        db.refresh(server)
    await warm_pool.ensure_node_has_warm_sandboxes(node.id)
    return with_node(server, node)


@router.post("/{server_id}/start")
async def start_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        if server.status == "running":
            return with_node(server, node)
        if server.status != "stopped":
            raise HTTPException(409, f"server is {server.status}; it cannot be started")
        if not warm_pool.node_has_vm_capacity(db, node):
            raise HTTPException(429, "node is at its configured VM capacity; stop something first")
    await node_transport.request(node, "POST", f"/sandboxes/{server.vm_id}/start")
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        server.status = "running"
        db.add(server)
        db.commit()
        db.refresh(server)
    await warm_pool.reconcile_node_warm_pool(node.id)
    return with_node(server, node)


@router.delete("/{server_id}", status_code=204)
async def delete_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    # Tombstone first, then read vm_id back: a provision finishing mid-delete
    # commits its vm_id before this update, so the VM is never orphaned.
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        server.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(server)
        db.commit()
        db.refresh(server)
        vm_id = server.vm_id
    if vm_id:
        try:
            await node_transport.request(node, "DELETE", f"/sandboxes/{vm_id}")
        except HTTPException:
            # The VM may never have booted (failed provision) or is already gone.
            pass
    await warm_pool.ensure_node_has_warm_sandboxes(node.id)
