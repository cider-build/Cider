from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from sqlmodel import select

from ..db import get_session
from ..models import Node, Sandbox

router = APIRouter(prefix="/sandboxes")
http = httpx.AsyncClient(timeout=None)


@router.get("")
async def list_sandboxes() -> list[Sandbox]:
    db = get_session()
    return db.exec(
        select(Sandbox)
        .where(Sandbox.deleted_at.is_(None))
        .order_by(Sandbox.created_at.desc())
    ).all()


@router.post("", status_code=201)
async def create_sandbox(archive: UploadFile | None = File(None)) -> Sandbox:
    db = get_session()
    node = db.exec(select(Node).order_by(Node.name)).first()
    if node is None:
        raise HTTPException(404, "no nodes registered")

    try:
        files = None
        if archive is not None:
            files = {"archive": (archive.filename, await archive.read(), archive.content_type)}
        response = await http.post(f"{node.url.rstrip('/')}/sandboxes", files=files)
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
async def delete_sandbox(sandbox_id: str) -> None:
    db = get_session()
    sandbox = db.get(Sandbox, sandbox_id)

    if sandbox is None or sandbox.deleted_at is not None:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    
    if node is None:
        raise HTTPException(404, "node not found")

    try:
        response = await http.delete(f"{node.url.rstrip('/')}/sandboxes/{sandbox.id}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

    sandbox.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(sandbox)
    db.commit()
