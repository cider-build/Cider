import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlmodel import select

from ..auth import hash_token
from ..db import get_session
from ..models import Node, NodeCredential
from ..services import warm_pool
from ..services.node_gateway import node_gateway

router = APIRouter(tags=["node-connections"])

# Connected nodes send a heartbeat every 20 seconds; a silent connection is half-open.
LIVENESS_TIMEOUT_SECONDS = 60


@router.websocket("/node-connections/{node_id}")
async def connect_node(websocket: WebSocket, node_id: str) -> None:
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
        node = db.get(Node, node_id)
    if credential is None or node is None:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="invalid node credential",
        )
        return

    await websocket.accept()
    connection = await node_gateway.add(node_id, websocket)

    await warm_pool.ensure_node_has_warm_sandboxes(node)
    try:
        while True:
            message = await asyncio.wait_for(websocket.receive(), timeout=LIVENESS_TIMEOUT_SECONDS)
            if message["type"] == "websocket.disconnect":
                break
            if message.get("text") is not None:
                await node_gateway.handle_text(connection, message["text"])
            elif message.get("bytes") is not None:
                node_gateway.handle_bytes(connection, message["bytes"])
    except TimeoutError:
        with contextlib.suppress(RuntimeError):
            await websocket.close(
                code=status.WS_1011_INTERNAL_ERROR,
                reason="node liveness timeout",
            )
    except (WebSocketDisconnect, RuntimeError):
        return
    except (ValueError, KeyError):
        await websocket.close(
            code=status.WS_1003_UNSUPPORTED_DATA,
            reason="invalid connector message",
        )
    finally:
        await node_gateway.remove(node_id, connection)
