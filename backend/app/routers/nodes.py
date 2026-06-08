from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Node

router = APIRouter(prefix="/nodes")


class NodeIn(BaseModel):
    name: str
    url: str


@router.get("")
def list_nodes(db: Session = Depends(get_session)) -> list[Node]:
    return db.exec(select(Node).order_by(Node.name)).all()


@router.post("", status_code=201)
def create_node(body: NodeIn, db: Session = Depends(get_session)) -> Node:
    if db.exec(select(Node).where(Node.name == body.name)).first():
        raise HTTPException(409, "node name already exists")

    node = Node(name=body.name, url=body.url)
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=204)
def delete_node(node_id: str, db: Session = Depends(get_session)) -> None:
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(404, "node not found")
    db.delete(node)
    db.commit()
