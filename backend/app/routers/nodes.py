import math
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from ..auth import AuthContext, current_auth_context, hash_token
from ..db import get_session
from ..models import Node, NodeCredential, Sandbox
from ..services.node_gateway import node_gateway

router = APIRouter(prefix="/nodes")
PAGE_SIZE = 10
NodeName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class NodeOut(BaseModel):
    id: str
    name: str
    connected: bool


class NodePage(BaseModel):
    items: list[NodeOut]
    page: int
    pages: int
    total: int


class NodeEnrollmentIn(BaseModel):
    name: NodeName


class NodeEnrollmentOut(BaseModel):
    id: str
    name: str
    token: str


@router.get("")
async def list_nodes(
    ctx: AuthContext = Depends(current_auth_context),
    page: int = Query(default=1, ge=1),
    search: str = "",
) -> NodePage:
    db = get_session()
    query = (
        select(Node)
        .join(NodeCredential, NodeCredential.node_id == Node.id)
        .where(Node.org_id == ctx.membership.organization_id)
    )
    count_query = (
        select(func.count())
        .select_from(Node)
        .join(NodeCredential, NodeCredential.node_id == Node.id)
        .where(Node.org_id == ctx.membership.organization_id)
    )
    if search:
        like = f"%{search}%"
        query = query.where(Node.name.like(like))
        count_query = count_query.where(Node.name.like(like))
    total = db.exec(count_query).one()
    pages = max(1, math.ceil(total / PAGE_SIZE))
    page = min(page, pages)
    items = db.exec(query.order_by(Node.name).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)).all()
    return NodePage(items=[NodeOut(id=node.id, name=node.name, connected=node_gateway.is_connected(node.id)) for node in items], page=page, pages=pages, total=total)


@router.post("/enrollments", status_code=201)
async def enroll_node(body: NodeEnrollmentIn, ctx: AuthContext = Depends(current_auth_context)) -> NodeEnrollmentOut:
    db = get_session()
    token = secrets.token_urlsafe(32)
    existing = db.exec(select(Node).where(Node.org_id == ctx.membership.organization_id, Node.name == body.name)).first()
    if existing is not None:
        if node_gateway.is_connected(existing.id):
            raise HTTPException(409, "node name already exists and is connected")
        # Reactivate the retained node (possibly revoked) with a freshly rotated credential.
        credential = db.get(NodeCredential, existing.id)
        if credential is None:
            credential = NodeCredential(node_id=existing.id, token_hash=hash_token(token))
        else:
            credential.token_hash = hash_token(token)
            credential.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(credential)
        db.commit()
        return NodeEnrollmentOut(id=existing.id, name=existing.name, token=token)

    node = Node(name=body.name, org_id=ctx.membership.organization_id)
    db.add(node)
    db.add(NodeCredential(node_id=node.id, token_hash=hash_token(token)))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "node name already exists")
    return NodeEnrollmentOut(id=node.id, name=node.name, token=token)


@router.delete("/{node_id}", status_code=204)
async def delete_node(node_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    db = get_session()
    node = db.get(Node, node_id)
    credential = db.get(NodeCredential, node_id)
    if node is None or node.org_id != ctx.membership.organization_id or credential is None:
        raise HTTPException(404, "node not found")

    sandboxes = db.exec(select(Sandbox).where(Sandbox.node_id == node_id, Sandbox.deleted_at.is_(None))).all()
    if node_gateway.is_connected(node_id) and any(sandbox.org_id is not None for sandbox in sandboxes):
        raise HTTPException(409, "node has active sandboxes; delete them first")

    # Revoking the credential removes the node; its row is kept so sandbox history stays intact.
    # An offline node's remaining sandboxes are unreachable, so they are marked deleted. Snapshots are untouched.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for sandbox in sandboxes:
        sandbox.deleted_at = now
        db.add(sandbox)
    db.delete(credential)
    db.commit()
    await node_gateway.disconnect(node_id)
