import asyncio
import contextlib
import json
import uuid
from dataclasses import dataclass, field

from fastapi import WebSocket, status

CHUNK_SIZE = 256 * 1024
REQUEST_TIMEOUT_SECONDS = 300


class NodeUnavailableError(RuntimeError):
    """Raised when an enrolled node cannot service a tunneled request."""


@dataclass
class GatewayResponse:
    status_code: int
    headers: dict[str, str]
    content: bytes


@dataclass
class PendingRequest:
    future: asyncio.Future[GatewayResponse]
    status_code: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    body: bytearray = field(default_factory=bytearray)


@dataclass
class NodeConnection:
    websocket: WebSocket
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    pending: dict[str, PendingRequest] = field(default_factory=dict)


class NodeGateway:
    def __init__(self) -> None:
        self._connections: dict[str, NodeConnection] = {}
        self._lock = asyncio.Lock()

    async def add(self, node_id: str, websocket: WebSocket) -> NodeConnection:
        connection = NodeConnection(websocket=websocket)
        async with self._lock:
            existing = self._connections.pop(node_id, None)
            self._connections[node_id] = connection
        if existing is not None:
            self._fail_pending(
                existing, NodeUnavailableError("node connection was superseded")
            )
            with contextlib.suppress(RuntimeError):
                await existing.websocket.close(
                    code=status.WS_1008_POLICY_VIOLATION,
                    reason="superseded by a new connection",
                )
        return connection

    async def remove(self, node_id: str, connection: NodeConnection) -> None:
        async with self._lock:
            if self._connections.get(node_id) is connection:
                self._connections.pop(node_id)
        self._fail_pending(connection, NodeUnavailableError("node disconnected"))

    def is_connected(self, node_id: str) -> bool:
        return node_id in self._connections

    async def disconnect(self, node_id: str) -> None:
        async with self._lock:
            connection = self._connections.pop(node_id, None)
        if connection is not None:
            self._fail_pending(connection, NodeUnavailableError("node revoked"))
            with contextlib.suppress(RuntimeError):
                await connection.websocket.close(
                    code=status.WS_1008_POLICY_VIOLATION,
                    reason="node revoked",
                )

    async def close(self) -> None:
        async with self._lock:
            connections = list(self._connections.values())
            self._connections.clear()
        for connection in connections:
            self._fail_pending(connection, NodeUnavailableError("service restarting"))
            with contextlib.suppress(RuntimeError):
                await connection.websocket.close(
                    code=status.WS_1012_SERVICE_RESTART,
                    reason="service restarting",
                )

    async def request(
        self,
        node_id: str,
        method: str,
        path: str,
        headers: dict[str, str],
        body: bytes,
    ) -> GatewayResponse:
        connection = self._connections.get(node_id)
        if connection is None:
            raise NodeUnavailableError("node is not connected")

        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        connection.pending[request_id] = PendingRequest(future=future)
        try:
            async with connection.send_lock:
                await connection.websocket.send_json(
                    {
                        "type": "request",
                        "id": request_id,
                        "method": method,
                        "path": path,
                        "headers": headers,
                        "body_length": len(body),
                    }
                )
                await self._send_body(connection.websocket, request_id, body)
            return await asyncio.wait_for(future, timeout=REQUEST_TIMEOUT_SECONDS)
        except TimeoutError as error:
            raise NodeUnavailableError("node request timed out") from error
        except RuntimeError as error:
            raise NodeUnavailableError("node connection failed") from error
        finally:
            connection.pending.pop(request_id, None)

    async def handle_text(self, connection: NodeConnection, raw: str) -> None:
        message = json.loads(raw)
        message_type = message.get("type")
        if message_type == "heartbeat":
            async with connection.send_lock:
                await connection.websocket.send_json({"type": "heartbeat_ack"})
            return
        if message_type != "response":
            raise ValueError("unsupported control message")

        pending = connection.pending.get(message.get("id"))
        if pending is None:
            return
        pending.status_code = int(message["status"])
        pending.headers = {
            str(key): str(value) for key, value in message.get("headers", {}).items()
        }

    def handle_bytes(self, connection: NodeConnection, frame: bytes) -> None:
        if len(frame) < 17:
            raise ValueError("invalid binary frame")
        request_id = uuid.UUID(bytes=frame[:16]).hex
        final = frame[16] == 1
        pending = connection.pending.get(request_id)
        if pending is None:
            return
        pending.body.extend(frame[17:])
        if final and not pending.future.done():
            if pending.status_code is None:
                pending.future.set_exception(
                    RuntimeError("response body arrived before response metadata")
                )
            else:
                pending.future.set_result(
                    GatewayResponse(
                        status_code=pending.status_code,
                        headers=pending.headers,
                        content=bytes(pending.body),
                    )
                )

    @staticmethod
    async def _send_body(websocket: WebSocket, request_id: str, body: bytes) -> None:
        identifier = uuid.UUID(hex=request_id).bytes
        if not body:
            await websocket.send_bytes(identifier + b"\x01")
            return
        for offset in range(0, len(body), CHUNK_SIZE):
            chunk = body[offset : offset + CHUNK_SIZE]
            final = offset + len(chunk) == len(body)
            await websocket.send_bytes(identifier + bytes([int(final)]) + chunk)

    @staticmethod
    def _fail_pending(connection: NodeConnection, error: Exception) -> None:
        for pending in connection.pending.values():
            if not pending.future.done():
                pending.future.set_exception(error)


node_gateway = NodeGateway()
