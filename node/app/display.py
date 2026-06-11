import asyncio
import socket
import uuid
from dataclasses import dataclass
from urllib.parse import quote

from . import config, tart


@dataclass
class DisplaySession:
    id: str
    sandbox_id: str
    host: str
    port: int
    url: str


_servers: dict[str, asyncio.AbstractServer] = {}
_sessions_by_sandbox: dict[str, DisplaySession] = {}


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((config.DISPLAY_BIND_HOST, 0))
        return int(sock.getsockname()[1])


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(64 * 1024):
            writer.write(data)
            await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def open_display(sandbox_id: str) -> DisplaySession:
    existing = _sessions_by_sandbox.get(sandbox_id)
    if existing is not None:
        return existing

    guest_ip = (await tart.tart("ip", sandbox_id, "--wait", str(config.START_TIMEOUT_SECONDS))).strip()
    local_port = _free_port()

    async def handle_client(
        client_reader: asyncio.StreamReader,
        client_writer: asyncio.StreamWriter,
    ) -> None:
        try:
            vnc_reader, vnc_writer = await asyncio.open_connection(guest_ip, config.DISPLAY_GUEST_PORT)
        except Exception:
            client_writer.close()
            await client_writer.wait_closed()
            return

        await asyncio.gather(
            _pipe(client_reader, vnc_writer),
            _pipe(vnc_reader, client_writer),
            return_exceptions=True,
        )

    server = await asyncio.start_server(handle_client, config.DISPLAY_BIND_HOST, local_port)
    if config.DISPLAY_USERNAME and config.DISPLAY_PASSWORD:
        username = quote(config.DISPLAY_USERNAME, safe="")
        password = quote(config.DISPLAY_PASSWORD, safe="")
        url = f"vnc://{username}:{password}@{config.DISPLAY_PUBLIC_HOST}:{local_port}"
    elif config.DISPLAY_USERNAME:
        username = quote(config.DISPLAY_USERNAME, safe="")
        url = f"vnc://{username}@{config.DISPLAY_PUBLIC_HOST}:{local_port}"
    else:
        url = f"vnc://{config.DISPLAY_PUBLIC_HOST}:{local_port}"

    session = DisplaySession(
        id=uuid.uuid4().hex,
        sandbox_id=sandbox_id,
        host=config.DISPLAY_PUBLIC_HOST,
        port=local_port,
        url=url,
    )
    _servers[session.id] = server
    _sessions_by_sandbox[sandbox_id] = session
    return session


async def close_display(session_id: str) -> None:
    server = _servers.pop(session_id, None)
    if server is None:
        return

    for sandbox_id, session in list(_sessions_by_sandbox.items()):
        if session.id == session_id:
            _sessions_by_sandbox.pop(sandbox_id, None)

    server.close()
    await server.wait_closed()


async def close_sandbox_display(sandbox_id: str) -> None:
    session = _sessions_by_sandbox.get(sandbox_id)
    if session is not None:
        await close_display(session.id)
