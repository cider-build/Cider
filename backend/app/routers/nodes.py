import math

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import select

from ..auth import AuthContext, current_auth_context
from ..services import warm_pool
from ..db import get_session
from ..models import Node

router = APIRouter(prefix="/nodes")
http = httpx.AsyncClient()
PAGE_SIZE = 10


class NodeIn(BaseModel):
    name: str
    url: str


class NodePage(BaseModel):
    items: list[Node]
    page: int
    pages: int
    total: int


@router.get("")
async def list_nodes(
    ctx: AuthContext = Depends(current_auth_context),
    page: int = Query(default=1, ge=1),
    search: str = "",
) -> NodePage:
    db = get_session()
    query = select(Node).where(Node.org_id == ctx.membership.organization_id)
    count_query = select(func.count()).select_from(Node).where(Node.org_id == ctx.membership.organization_id)
    if search:
        like = f"%{search}%"
        query = query.where(Node.name.like(like))
        count_query = count_query.where(Node.name.like(like))
    total = db.exec(count_query).one()
    pages = max(1, math.ceil(total / PAGE_SIZE))
    page = min(page, pages)
    items = db.exec(query.order_by(Node.name).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)).all()
    return NodePage(items=items, page=page, pages=pages, total=total)


@router.post("", status_code=201)
async def create_node(body: NodeIn, ctx: AuthContext = Depends(current_auth_context)) -> Node:
    db = get_session()
    if db.exec(select(Node).where(Node.org_id == ctx.membership.organization_id, Node.name == body.name)).first():
        raise HTTPException(409, "node name already exists")

    try:
        response = await http.get(f"{body.url.rstrip('/')}/openapi.json")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    if response.status_code != 200:
        raise HTTPException(400, "node did not look like a Cider node")

    node = Node(name=body.name, url=body.url, org_id=ctx.membership.organization_id)
    db.add(node)
    db.commit()
    db.refresh(node)
    await warm_pool.ensure_node_has_warm_sandboxes(node)
    return node


@router.delete("/{node_id}", status_code=204)
async def delete_node(node_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    db = get_session()
    node = db.get(Node, node_id)
    if node is None or node.org_id != ctx.membership.organization_id:
        raise HTTPException(404, "node not found")
    db.delete(node)
    db.commit()
