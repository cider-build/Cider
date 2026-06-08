from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Node, Sandbox

router = APIRouter(prefix="/sandboxes")


class CreateSandboxIn(BaseModel):
    node_id: str


@router.get("")
def list_sandboxes(db: Session = Depends(get_session)) -> list[Sandbox]:
    return db.exec(
        select(Sandbox)
        .where(Sandbox.deleted_at.is_(None))
        .order_by(Sandbox.created_at.desc())
    ).all()


@router.post("", status_code=201)
async def create_sandbox(body: CreateSandboxIn, db: Session = Depends(get_session)) -> Sandbox:
    node = db.get(Node, body.node_id)
    if node is None:
        raise HTTPException(404, "node not found")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{node.url.rstrip('/')}/sandboxes", json={})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

    sandbox = Sandbox(id=response.json()["id"], node_id=node.id)
    db.add(sandbox)
    db.commit()
    db.refresh(sandbox)
    return sandbox


@router.delete("/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str, db: Session = Depends(get_session)) -> None:
    sandbox = db.get(Sandbox, sandbox_id)
    if sandbox is None or sandbox.deleted_at is not None:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.delete(f"{node.url.rstrip('/')}/sandboxes/{sandbox.id}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

    sandbox.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(sandbox)
    db.commit()
