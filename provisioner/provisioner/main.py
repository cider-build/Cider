import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import Depends, FastAPI, HTTPException
from sqlmodel import Session, SQLModel, select

from . import health
from .models import Node, Sandbox, init, session


class NodeIn(SQLModel):
    name: str
    url: str


class SandboxIn(SQLModel):
    node_id: int


class ExecIn(SQLModel):
    command: str


class ExecOut(SQLModel):
    stdout: str
    stderr: str
    exit_code: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    init()
    task = asyncio.create_task(health.run_forever())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Cider Provisioner", lifespan=lifespan)


def _forward_error(r: httpx.Response) -> None:
    try:
        body = r.json()
        detail = body.get("detail", body) if isinstance(body, dict) else body
    except ValueError:
        detail = r.text
    raise HTTPException(r.status_code, detail)


def _get_node(db: Session, node_id: int) -> Node:
    node = db.get(Node, node_id)
    if not node:
        raise HTTPException(404, f"node {node_id} not found")
    return node


def _get_sandbox(db: Session, sandbox_id: str) -> Sandbox:
    sb = db.get(Sandbox, sandbox_id)
    if not sb:
        raise HTTPException(404, f"sandbox {sandbox_id} not found")
    return sb


@app.post("/nodes", response_model=Node)
def register_node(body: NodeIn, db: Session = Depends(session)) -> Node:
    node = Node(name=body.name, url=body.url)
    db.add(node)
    try:
        db.commit()
    except Exception as e:
        raise HTTPException(400, f"could not register node: {e}")
    db.refresh(node)
    return node


@app.get("/nodes", response_model=list[Node])
def list_nodes(db: Session = Depends(session)) -> list[Node]:
    return db.exec(select(Node).order_by(Node.id)).all()


@app.post("/sandboxes", response_model=Sandbox)
async def create_sandbox(body: SandboxIn, db: Session = Depends(session)) -> Sandbox:
    node = _get_node(db, body.node_id)
    sandbox_id = str(uuid.uuid4())

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{node.url.rstrip('/')}/sandboxes", json={"id": sandbox_id})
    if r.status_code >= 400:
        _forward_error(r)

    sb = Sandbox(id=sandbox_id, node_id=node.id, created_at=datetime.now(timezone.utc))
    db.add(sb)
    db.commit()
    db.refresh(sb)
    return sb


@app.post("/sandboxes/{sandbox_id}/exec", response_model=ExecOut)
async def exec_command(sandbox_id: str, body: ExecIn, db: Session = Depends(session)) -> ExecOut:
    sb = _get_sandbox(db, sandbox_id)
    node = _get_node(db, sb.node_id)
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{node.url.rstrip('/')}/sandboxes/{sandbox_id}/exec",
            json=body.model_dump(),
        )
    if r.status_code >= 400:
        _forward_error(r)
    return ExecOut(**r.json())


@app.delete("/sandboxes/{sandbox_id}")
async def delete_sandbox(sandbox_id: str, db: Session = Depends(session)) -> dict:
    sb = _get_sandbox(db, sandbox_id)
    node = _get_node(db, sb.node_id)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.delete(f"{node.url.rstrip('/')}/sandboxes/{sandbox_id}")
    if r.status_code >= 400:
        _forward_error(r)
    db.delete(sb)
    db.commit()
    return {"ok": True}


def run() -> None:
    import uvicorn

    uvicorn.run("provisioner.main:app", host="0.0.0.0", port=8000, reload=False)
