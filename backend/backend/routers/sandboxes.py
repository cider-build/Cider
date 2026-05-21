import asyncio
import socket
from datetime import datetime

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlmodel import Session as DbSession
from sqlmodel import select

from .. import node_client, ws_tickets
from ..config import settings
from ..db import engine
from ..deps import CurrentOrg, Db
from ..models import Node, Org, OrgMembership, Sandbox, SandboxStatus, Session, User
from ..models._time import utcnow
from ..node_schema import (
    NodeCreateRequest,
    NodeCreateResponse,
    NodeExecRequest,
    NodeExecResponse,
    NodeIPResponse,
)

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


class ConnectOut(BaseModel):
    ip: str
    vnc_url: str
    ssh_url: str


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

    # Node picks the id (pulls from its warm pool when possible, falls back to
    # a fresh clone otherwise). We mirror whatever id it returns into our DB.
    result = await node_client.call(
        "POST",
        node.url,
        "/sandboxes",
        body=NodeCreateRequest(),
        response_model=NodeCreateResponse,
    )

    sb = Sandbox(id=result.id, org_id=org.id, node_id=node.id, status=SandboxStatus.running)
    db.add(sb)
    db.commit()
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


@router.get("/{sandbox_id}/connect", response_model=ConnectOut)
async def connect_info(sandbox_id: str, db: Db, org: CurrentOrg) -> ConnectOut:
    """Return URLs the user can paste/click to open a Screen Sharing or SSH session.

    The macOS guest serves VNC on port 5900 once Screen Sharing is enabled in
    System Settings; `vnc://` is a registered URL scheme so Safari/Chrome on
    macOS hand it off to the built-in Screen Sharing app.
    """
    sb = _get_org_sandbox(db, org, sandbox_id)
    if sb.status != SandboxStatus.running:
        raise HTTPException(status.HTTP_409_CONFLICT, f"sandbox is {sb.status}")
    node = db.get(Node, sb.node_id)
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "node not found")

    result = await node_client.call(
        "GET", node.url, f"/sandboxes/{sb.id}/ip", response_model=NodeIPResponse
    )
    return ConnectOut(
        ip=result.ip,
        # Legacy-VNC auth: empty username, shared password set inside the VM.
        vnc_url=f"vnc://:{settings.vnc_password}@{result.ip}",
        ssh_url=f"ssh://admin@{result.ip}",
    )


def _resolve_ws_sandbox(user_id: str | None, sandbox_id: str) -> tuple[Sandbox, Node] | None:
    """Org-scoped sandbox lookup for WebSocket routes.

    `user_id` should already be authenticated (via cookie or ws-ticket). Returns
    (sandbox, node) detached from the DB session, or None if the sandbox isn't
    accessible to this user.
    """
    if not user_id:
        return None
    with DbSession(engine) as db:
        membership = db.exec(
            select(OrgMembership).where(OrgMembership.user_id == user_id)
        ).first()
        if not membership:
            return None
        sb = db.get(Sandbox, sandbox_id)
        if (
            sb is None
            or sb.org_id != membership.org_id
            or sb.status != SandboxStatus.running
        ):
            return None
        node = db.get(Node, sb.node_id)
        if node is None:
            return None
        db.expunge(sb)
        db.expunge(node)
        return sb, node


def _ws_user_id(websocket: WebSocket) -> str | None:
    """Resolve the authenticated user for a WS handshake. Prefers ?ticket=
    (which JS can carry across origins), falls back to the session cookie
    (works only same-origin)."""
    ticket = websocket.query_params.get("ticket")
    user_id = ws_tickets.redeem(ticket)
    if user_id:
        return user_id

    token = websocket.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    with DbSession(engine) as db:
        session = db.get(Session, token)
        if not session or session.expires_at < utcnow():
            return None
        return session.user_id


@router.websocket("/{sandbox_id}/vnc")
async def vnc_websocket(websocket: WebSocket, sandbox_id: str) -> None:
    """Bridge a WebSocket from the dashboard to the VM's RFB (VNC) port.

    noVNC in the browser connects here over `ws://`; we pipe raw bytes to
    127.0.0.1-style TCP on the VM's IP:5900. Auth happens via the same
    cookie session the rest of the API uses.
    """
    user_id = _ws_user_id(websocket)
    resolved = _resolve_ws_sandbox(user_id, sandbox_id)
    if resolved is None:
        await websocket.close(code=1008, reason="unauthorized or sandbox unavailable")
        return
    sb, node = resolved

    try:
        ip_response = await node_client.call(
            "GET", node.url, f"/sandboxes/{sb.id}/ip", response_model=NodeIPResponse
        )
    except HTTPException as e:
        await websocket.close(code=1011, reason=f"ip lookup failed: {e.detail}")
        return

    try:
        reader, writer = await asyncio.open_connection(ip_response.ip, 5900)
    except OSError as e:
        await websocket.close(code=1011, reason=f"VNC connect failed: {e}")
        return

    # Disable Nagle on the upstream TCP socket. RFB sends a lot of small control
    # messages (FramebufferUpdateRequest, keystrokes, pointer moves); Nagle was
    # batching them and adding ~40ms latency hops per interaction.
    upstream_sock = writer.get_extra_info("socket")
    if upstream_sock is not None:
        try:
            upstream_sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

    # noVNC's default subprotocol. Accepting it makes the browser happy; the
    # bytes themselves are raw RFB regardless.
    await websocket.accept(subprotocol="binary")

    async def pump_ws_to_tcp() -> None:
        try:
            while True:
                data = await websocket.receive_bytes()
                writer.write(data)
                await writer.drain()
        except WebSocketDisconnect:
            pass

    async def read_exact(n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = await reader.read(n - len(buf))
            if not chunk:
                raise ConnectionError("server closed mid-handshake")
            buf += chunk
        return buf

    async def pump_tcp_to_ws() -> None:
        """Forward bytes from the VM to the browser, but hide Apple's ARD
        security type from the handshake so noVNC falls back to plain VncAuth.

        macOS Screen Sharing offers ~5 types ([30, 33, 36, 2, 35]); noVNC picks
        the first one it understands, which is 30 (Apple ARD) — and noVNC's
        ARD implementation refuses our creds. We rewrite the list to just
        `[2]` (VncAuth), which uses the legacy VNC password we know works.
        """
        try:
            # 1) Forward the server's 12-byte protocol version verbatim.
            await websocket.send_bytes(await read_exact(12))

            # 2) Wait for the security-types message and rewrite it.
            count_byte = await read_exact(1)
            count = count_byte[0]
            if count == 0:
                # Failure case: count=0 followed by 4-byte reason length + reason.
                await websocket.send_bytes(count_byte)
            else:
                types = await read_exact(count)
                if 2 in types:
                    await websocket.send_bytes(bytes([1, 2]))
                else:
                    # No VncAuth available — pass through; noVNC will likely fail
                    # but we shouldn't fabricate a type that isn't offered.
                    await websocket.send_bytes(count_byte + types)

            # 3) From here on it's all opaque encoded data — pure passthrough.
            # Big reads keep WS frame count low: a Tight-encoded framebuffer
            # update for a Retina-ish display is often 50-500KB, and breaking
            # it into 8KB chunks meant 10-60 WS frames per refresh, each with
            # an asyncio + Starlette hop.
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                await websocket.send_bytes(data)
        except (ConnectionResetError, BrokenPipeError, ConnectionError):
            pass

    try:
        await asyncio.gather(pump_ws_to_tcp(), pump_tcp_to_ws(), return_exceptions=True)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass
        try:
            await websocket.close()
        except RuntimeError:
            pass  # already closed


@router.delete("/{sandbox_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sandbox(sandbox_id: str, db: Db, org: CurrentOrg) -> None:
    sb = _get_org_sandbox(db, org, sandbox_id)
    node = db.get(Node, sb.node_id)

    # Best-effort: tell the node to tear the VM down, but always mark the
    # sandbox deleted in our DB so the dashboard never gets stuck with a row
    # the user can't get rid of. An orphan VM can be cleaned via
    # `ciderctl delete <id>` directly.
    if node is not None:
        try:
            await node_client.fire("DELETE", node.url, f"/sandboxes/{sb.id}")
        except HTTPException:
            pass

    sb.status = SandboxStatus.deleted
    sb.deleted_at = utcnow()
    db.add(sb)
    db.commit()
