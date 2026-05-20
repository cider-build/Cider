import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from sqlmodel import Session, SQLModel, select

from . import sandbox as runtime
from .models import Sandbox, init, session

MAX_SANDBOXES = int(os.environ.get("MAX_SANDBOXES", "2"))


class CreateIn(SQLModel):
    id: str


class ExecIn(SQLModel):
    command: str


class ExecOut(SQLModel):
    stdout: str
    stderr: str
    exit_code: int


class HealthOut(SQLModel):
    ok: bool
    active: int
    capacity: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    init()
    yield


app = FastAPI(title="Cider Node", lifespan=lifespan)


def _active_count(db: Session) -> int:
    return len(db.exec(select(Sandbox).where(Sandbox.status == "running")).all())


@app.get("/health", response_model=HealthOut)
def health(db: Session = Depends(session)) -> HealthOut:
    return HealthOut(ok=True, active=_active_count(db), capacity=MAX_SANDBOXES)


@app.post("/sandboxes", response_model=Sandbox)
def create_sandbox(body: CreateIn, db: Session = Depends(session)) -> Sandbox:
    if _active_count(db) >= MAX_SANDBOXES:
        raise HTTPException(409, "node at capacity")

    sb = Sandbox(id=body.id, created_at=datetime.now(timezone.utc), status="running")
    db.add(sb)
    try:
        db.commit()
    except Exception as e:
        raise HTTPException(400, f"could not create: {e}")
    db.refresh(sb)

    runtime.create(sb.id)
    return sb


@app.post("/sandboxes/{sandbox_id}/exec", response_model=ExecOut)
def exec_command(sandbox_id: str, body: ExecIn, db: Session = Depends(session)) -> ExecOut:
    sb = db.get(Sandbox, sandbox_id)
    if not sb or sb.status != "running":
        raise HTTPException(404, f"sandbox {sandbox_id} not found")
    stdout, stderr, exit_code = runtime.exec_command(sandbox_id, body.command)
    return ExecOut(stdout=stdout, stderr=stderr, exit_code=exit_code)


@app.delete("/sandboxes/{sandbox_id}")
def delete_sandbox(sandbox_id: str, db: Session = Depends(session)) -> dict:
    sb = db.get(Sandbox, sandbox_id)
    if not sb:
        raise HTTPException(404, f"sandbox {sandbox_id} not found")
    db.delete(sb)
    db.commit()
    runtime.delete(sandbox_id)
    return {"ok": True}


def run() -> None:
    import uvicorn

    uvicorn.run("node.main:app", host="0.0.0.0", port=8001, reload=False)
