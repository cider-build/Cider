from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select

from ..deps import CurrentOrg, Db
from ..models import Node

router = APIRouter(prefix="/nodes", tags=["nodes"])


class NodeIn(BaseModel):
    name: str
    url: str


class NodeOut(BaseModel):
    id: str
    name: str
    url: str
    last_ping_at: datetime | None
    last_ping_ok: bool | None


def _to_out(n: Node) -> NodeOut:
    return NodeOut(
        id=n.id, name=n.name, url=n.url, last_ping_at=n.last_ping_at, last_ping_ok=n.last_ping_ok
    )


@router.get("", response_model=list[NodeOut])
def list_nodes(db: Db, org: CurrentOrg) -> list[NodeOut]:
    rows = db.exec(select(Node).where(Node.org_id == org.id).order_by(Node.created_at)).all()
    return [_to_out(n) for n in rows]


@router.post("", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
def register_node(body: NodeIn, db: Db, org: CurrentOrg) -> NodeOut:
    existing = db.exec(
        select(Node).where(Node.org_id == org.id, Node.name == body.name)
    ).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "node name already exists in org")
    node = Node(org_id=org.id, name=body.name, url=body.url)
    db.add(node)
    db.commit()
    db.refresh(node)
    return _to_out(node)


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_node(node_id: str, db: Db, org: CurrentOrg) -> None:
    node = db.get(Node, node_id)
    if not node or node.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "node not found")
    db.delete(node)
    db.commit()
