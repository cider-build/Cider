from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session as DbSession
from sqlmodel import select

from .. import node_client
from ..deps import CurrentOrg, Db
from ..models import Node, Org, Sandbox, SandboxStatus
from ..models._time import utcnow
from ..node_schema import NodeCreateRequest, NodeExecRequest, NodeExecResponse

router = APIRouter(prefix="/sandboxes", tags=["sandboxes"])


class CreateIn(BaseModel):
    node_id: str


class ExecIn(BaseModel):
    command: str


class ExecOut(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


class SandboxOut(BaseModel):
    id: str
    node_id: str
    status: SandboxStatus
    created_at: datetime


def _to_out(sb: Sandbox) -> SandboxOut:
    return SandboxOut(id=sb.id, node_id=sb.node_id, status=sb.status, created_at=sb.created_at)


def _get_org_node(db: DbSession, org: Org, node_id: str) -> Node:
    node = db.get(Node, node_id)
    if not node or node.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "node not found")
    return node


def _get_org_sandbox(db: DbSession, org: Org, sandbox_id: str) -> Sandbox:
    sb = db.get(Sandbox, sandbox_id)
    if not sb or sb.org_id != org.id or sb.status == SandboxStatus.deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sandbox not found")
    return sb


def _mark_status(db: DbSession, sb: Sandbox, status: SandboxStatus) -> None:
    sb.status = status
    db.add(sb)
    db.commit()


@router.get("", response_model=list[SandboxOut])
def list_sandboxes(db: Db, org: CurrentOrg) -> list[SandboxOut]:
    rows = db.exec(
        select(Sandbox)
        .where(Sandbox.org_id == org.id, Sandbox.status != SandboxStatus.deleted)
        .order_by(Sandbox.created_at.desc())
    ).all()
    return [_to_out(s) for s in rows]


@router.post("", response_model=SandboxOut, status_code=status.HTTP_201_CREATED)
async def create_sandbox(body: CreateIn, db: Db, org: CurrentOrg) -> SandboxOut:
    node = _get_org_node(db, org, body.node_id)

    sb = Sandbox(org_id=org.id, node_id=node.id, status=SandboxStatus.pending)
    db.add(sb)
    db.commit()
    db.refresh(sb)

    try:
        await node_client.fire(
            "POST", node.url, "/sandboxes", body=NodeCreateRequest(id=sb.id)
        )
    except HTTPException:
        _mark_status(db, sb, SandboxStatus.failed)
        raise

    _mark_status(db, sb, SandboxStatus.running)
    db.refresh(sb)
    return _to_out(sb)


@router.post("/{sandbox_id}/exec", response_model=ExecOut)
async def exec_command(sandbox_id: str, body: ExecIn, db: Db, org: CurrentOrg) -> ExecOut:
    sb = _get_org_sandbox(db, org, sandbox_id)
    if sb.status != SandboxStatus.running:
        raise HTTPException(status.HTTP_409_CONFLICT, f"sandbox is {sb.status}")
    node = db.get(Node, sb.node_id)
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "node not found")

    result = await node_client.call(
        "POST",
        node.url,
        f"/sandboxes/{sb.id}/exec",
        body=NodeExecRequest(command=body.command),
        response_model=NodeExecResponse,
    )
    return ExecOut(stdout=result.stdout, stderr=result.stderr, exit_code=result.exit_code)


@router.delete("/{sandbox_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sandbox(sandbox_id: str, db: Db, org: CurrentOrg) -> None:
    sb = _get_org_sandbox(db, org, sandbox_id)
    node = db.get(Node, sb.node_id)

    if node is not None:
        try:
            await node_client.fire("DELETE", node.url, f"/sandboxes/{sb.id}")
        except HTTPException as e:
            if e.status_code != status.HTTP_404_NOT_FOUND:
                raise

    sb.status = SandboxStatus.deleted
    sb.deleted_at = utcnow()
    db.add(sb)
    db.commit()
