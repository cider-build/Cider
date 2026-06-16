from datetime import datetime, timezone
import io
import json
import tarfile

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import select

from .. import storage
from ..db import get_session
from ..models import Node, Sandbox, Snapshot

router = APIRouter(prefix="/sandboxes")
http = httpx.AsyncClient(timeout=None)


class ExecuteInput(BaseModel):
    command: str


def extract_launch_config(archive: bytes) -> dict | None:
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = member.name.removeprefix("./").split("/")
            if len(parts) <= 2 and parts[-1] == "cider.json" and member.isfile():
                file = tar.extractfile(member)
                if file is None:
                    return None
                config = json.load(file)
                if not isinstance(config, dict):
                    raise ValueError("cider.json must be a JSON object")
                return config
    return None


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

    config = None
    try:
        files = None
        if archive is not None:
            archive_bytes = await archive.read()
            config = extract_launch_config(archive_bytes)
            files = {"archive": (archive.filename, archive_bytes, archive.content_type)}
        response = await http.post(f"{node.url.rstrip('/')}/sandboxes", files=files)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

    sandbox = Sandbox(
        id=response.json()["id"],
        node_id=node.id,
        launch_config=config,
    )
    db.add(sandbox)
    db.commit()
    db.refresh(sandbox)

    if config is not None:
        try:
            response = await http.post(f"{node.url.rstrip('/')}/sandboxes/{sandbox.id}/launch-config", json=config)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"node unreachable: {e}")
        if response.status_code >= 400:
            raise HTTPException(response.status_code, response.text)

    return sandbox


@router.post("/{sandbox_id}/snapshots", status_code=201)
async def snapshot_sandbox(sandbox_id: str) -> Snapshot:
    db = get_session()
    sandbox = db.get(Sandbox, sandbox_id)
    if sandbox is None or sandbox.deleted_at is not None:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")

    snapshot = Snapshot(source_sandbox_id=sandbox.id, launch_config=sandbox.launch_config)
    try:
        async with http.stream("POST", f"{node.url.rstrip('/')}/sandboxes/{sandbox.id}/export") as response:
            if response.status_code >= 400:
                raise HTTPException(response.status_code, (await response.aread()).decode())
            await storage.save_snapshot(snapshot.id, response.aiter_bytes())
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


@router.post("/{sandbox_id}/execute", status_code=200)
async def execute_sandbox(sandbox_id: str, body: ExecuteInput) -> dict:
    db = get_session()
    sandbox = db.get(Sandbox, sandbox_id)
    if sandbox is None or sandbox.deleted_at is not None:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")
        
    try:
        response = await http.post(f"{node.url}/sandboxes/{sandbox.id}/execute", json={"command": body.command})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

    return response.json()


@router.post("/{sandbox_id}/display", status_code=200)
async def open_display(sandbox_id: str) -> dict:
    db = get_session()
    sandbox = db.get(Sandbox, sandbox_id)
    if sandbox is None or sandbox.deleted_at is not None:
        raise HTTPException(404, "sandbox not found")

    node = db.get(Node, sandbox.node_id)
    if node is None:
        raise HTTPException(404, "node not found")

    try:
        response = await http.post(f"{node.url}/sandboxes/{sandbox.id}/display")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"node unreachable: {e}")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

    return response.json()


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
