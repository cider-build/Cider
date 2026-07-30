import asyncio
import contextlib

from fastapi import APIRouter, Depends, HTTPException, WebSocket, status
from pydantic import BaseModel
from sqlmodel import select

from ..auth import AuthContext, bearer_auth_context, current_auth_context, hash_token
from ..db import get_session
from ..models import Node, NodeCredential, Sandbox
from ..services.node_gateway import NodeUnavailableError, SshTunnel, node_gateway

router = APIRouter(tags=["ssh"])


class SshTarget(BaseModel):
    sandbox_id: str
    node_id: str
    node_name: str
    status: str


class SshSelection(BaseModel):
    sandbox_id: str


def available_ssh_targets(org_id: str) -> list[SshTarget]:
    with get_session() as db:
        rows = db.exec(
            select(Sandbox, Node)
            .join(Node, Sandbox.node_id == Node.id)
            .where(
                Sandbox.org_id == org_id,
                Sandbox.deleted_at.is_(None),
                Sandbox.status.in_(("active", "persistent")),
            )
            .order_by(Sandbox.created_at.desc())
        ).all()
    return [
        SshTarget(
            sandbox_id=sandbox.id,
            node_id=node.id,
            node_name=node.name,
            status=sandbox.status,
        )
        for sandbox, node in rows
        if node_gateway.is_connected(node.id)
    ]


@router.get("/ssh")
async def list_ssh_targets(
    ctx: AuthContext = Depends(current_auth_context),
) -> list[SshTarget]:
    return available_ssh_targets(ctx.membership.organization_id)


@router.post("/ssh")
async def select_ssh_target(
    selection: SshSelection,
    ctx: AuthContext = Depends(current_auth_context),
) -> SshTarget:
    available = available_ssh_targets(ctx.membership.organization_id)
    target = next(
        (
            target
            for target in available
            if target.sandbox_id == selection.sandbox_id
        ),
        None,
    )
    if target is None:
        raise HTTPException(404, "sandbox not found or unavailable")
    return target


async def pipe_websocket(source: WebSocket, destination: WebSocket) -> None:
    while True:
        message = await source.receive()
        if message["type"] == "websocket.disconnect":
            return
        if message.get("bytes") is None:
            raise RuntimeError("SSH tunnels only accept binary frames")
        await destination.send_bytes(message["bytes"])


@router.websocket("/ssh/{sandbox_id}")
async def user_ssh(websocket: WebSocket, sandbox_id: str) -> None:
    authorization = websocket.headers.get("authorization")
    try:
        with get_session() as db:
            ctx = bearer_auth_context(authorization, db)
            sandbox = db.get(Sandbox, sandbox_id)
            if (
                sandbox is None
                or sandbox.org_id != ctx.membership.organization_id
                or sandbox.deleted_at is not None
                or sandbox.status not in ("active", "persistent")
            ):
                raise HTTPException(404, "available sandbox not found")
            node = db.get(Node, sandbox.node_id)
            if node is None or not node_gateway.is_connected(node.id):
                raise HTTPException(404, "available sandbox not found")
            node_id = node.id
    except HTTPException as error:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason=str(error.detail),
        )
        return

    await websocket.accept()
    tunnel_id = None
    tunnel: SshTunnel | None = None
    try:
        tunnel_id, tunnel = await node_gateway.begin_ssh(node_id, sandbox_id)
        node_socket = await node_gateway.wait_for_ssh(tunnel)
        user_to_node = asyncio.create_task(pipe_websocket(websocket, node_socket))
        node_to_user = asyncio.create_task(pipe_websocket(node_socket, websocket))
        done, pending = await asyncio.wait(
            (user_to_node, node_to_user),
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        for task in done | pending:
            with contextlib.suppress(asyncio.CancelledError, RuntimeError):
                await task
    except NodeUnavailableError as error:
        with contextlib.suppress(RuntimeError):
            await websocket.close(
                code=status.WS_1011_INTERNAL_ERROR,
                reason=str(error),
            )
    finally:
        if tunnel_id is not None and tunnel is not None:
            await node_gateway.finish_ssh(tunnel_id, tunnel)
        with contextlib.suppress(RuntimeError):
            await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)


@router.websocket("/node-ssh/{node_id}/{tunnel_id}")
async def node_ssh(websocket: WebSocket, node_id: str, tunnel_id: str) -> None:
    authorization = websocket.headers.get("authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="invalid node credential",
        )
        return
    with get_session() as db:
        credential = db.exec(
            select(NodeCredential).where(
                NodeCredential.node_id == node_id,
                NodeCredential.token_hash == hash_token(token),
            )
        ).first()
    if credential is None:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="invalid node credential",
        )
        return
    await node_gateway.attach_ssh(node_id, tunnel_id, websocket)
