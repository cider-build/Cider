import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from ..auth import AuthContext, current_auth_context
from ..services import warm_pool
from ..db import get_session
from ..models import Node

router = APIRouter(prefix="/nodes")
http = httpx.AsyncClient()


class NodeIn(BaseModel):
    name: str
    url: str


@router.get("")
async def list_nodes(ctx: AuthContext = Depends(current_auth_context)) -> list[Node]:
    db = get_session()
    return db.exec(select(Node).where(Node.org_id == ctx.membership.organization_id).order_by(Node.name)).all()


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
