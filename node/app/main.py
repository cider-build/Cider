import asyncio
import contextlib
import fcntl
import json
import os
import pty
import shlex
import struct
import tempfile
import termios
from typing import Annotated

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Path,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

from . import config, lume, portable_snapshot
from .errors import NodeOperationError

app = FastAPI(title="Cider Node")


@app.exception_handler(NodeOperationError)
async def node_operation_error(_request: Request, error: NodeOperationError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(error)})


@app.on_event("startup")
async def watch_for_orphaning() -> None:
    # Exit when the connector dies so a replacement can bind the port.
    async def watchdog() -> None:
        while True:
            await asyncio.sleep(5)
            if os.getppid() == 1:
                print("[node] connector gone; exiting to free the port", flush=True)
                os._exit(0)

    asyncio.create_task(watchdog())


SnapshotId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]

_vm_locks: dict[str, asyncio.Lock] = {}


def vm_lock(sandbox_id: str) -> asyncio.Lock:
    return _vm_locks.setdefault(sandbox_id, asyncio.Lock())


@contextlib.asynccontextmanager
async def upload_path(archive: UploadFile):
    path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tgz") as file:
            path = file.name
            while chunk := await archive.read(1024 * 1024):
                file.write(chunk)
        yield path
    finally:
        if path is not None:
            os.unlink(path)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/sandboxes")
async def list_sandboxes() -> list[dict]:
    return [
        {"id": vm["name"], "status": vm["status"]}
        for vm in await lume.list_vms()
        if vm["name"] != config.BASE_VM
    ]


class ExecuteInput(BaseModel):
    command: str


class SnapshotInput(BaseModel):
    snapshot: SnapshotId


class RestoreInput(BaseModel):
    manifest: dict


class LaunchConfigIn(BaseModel):
    setup: str | list[str] | None = None
    start: str | None = None


@app.post("/sandboxes", status_code=201)
async def create_sandbox(archive: UploadFile | None = File(None)) -> dict:
    sandbox_id = None
    try:
        sandbox_id = await lume.create()
        if archive is not None:
            async with upload_path(archive) as path:
                await lume.upload(sandbox_id, path)
        return {"id": sandbox_id}
    except NodeOperationError:
        if sandbox_id:
            await lume.delete(sandbox_id)
        raise


@app.post("/sandboxes/{sandbox_id}/stop", status_code=204)
async def stop_sandbox(sandbox_id: str) -> None:
    async with vm_lock(sandbox_id):
        if await lume.find(sandbox_id) is None:
            raise HTTPException(404, "sandbox not found")
        await lume.stop(sandbox_id)


@app.post("/sandboxes/{sandbox_id}/start", status_code=204)
async def start_sandbox(sandbox_id: str) -> None:
    async with vm_lock(sandbox_id):
        vm = await lume.find(sandbox_id)
        if vm is None:
            raise HTTPException(404, "sandbox not found")
        if vm["status"] == "running":
            return
        await lume.start(sandbox_id)


@app.post("/sandboxes/{sandbox_id}/upload", status_code=204)
async def upload_sandbox(sandbox_id: str, archive: UploadFile = File(...)) -> None:
    async with vm_lock(sandbox_id):
        if await lume.find(sandbox_id) is None:
            raise HTTPException(404, "sandbox not found")
        async with upload_path(archive) as path:
            await lume.upload(sandbox_id, path)


@app.post("/sandboxes/{sandbox_id}/snapshots", status_code=201)
async def snapshot_sandbox(sandbox_id: str, body: SnapshotInput) -> dict:
    async with vm_lock(sandbox_id):
        vm = await lume.find(sandbox_id)
        if vm is None:
            raise HTTPException(404, "sandbox not found")
        snapshot_vm = config.snapshot_vm_name(body.snapshot)
        try:
            await lume.snapshot(sandbox_id, snapshot_vm)
        except NodeOperationError as error:
            raise NodeOperationError(f"live snapshot failed: {error}") from error
    return {"id": body.snapshot}


@app.post("/sandboxes/{sandbox_id}/portable-snapshots", status_code=201)
async def portable_snapshot_sandbox(sandbox_id: str, body: SnapshotInput) -> dict:
    async with vm_lock(sandbox_id):
        if await lume.find(sandbox_id) is None:
            raise HTTPException(404, "sandbox not found")
        try:
            manifest = await portable_snapshot.export(sandbox_id, body.snapshot)
        except NodeOperationError as error:
            raise NodeOperationError(f"portable snapshot failed: {error}") from error
    return {"id": body.snapshot, "manifest": manifest}


@app.post("/sandboxes/{sandbox_id}/restore", status_code=201)
async def restore_sandbox(sandbox_id: str, body: RestoreInput) -> dict:
    async with vm_lock(sandbox_id):
        if await lume.find(sandbox_id) is not None:
            raise HTTPException(409, "sandbox already exists on destination node")
        try:
            await portable_snapshot.restore(sandbox_id, body.manifest)
        except NodeOperationError as error:
            raise NodeOperationError(f"portable restore failed: {error}") from error
    return {"id": sandbox_id}


@app.delete("/sandboxes/{sandbox_id}/snapshots/{snapshot_id}", status_code=204)
async def delete_snapshot(sandbox_id: str, snapshot_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]) -> None:
    async with vm_lock(sandbox_id):
        snapshot_vm = config.snapshot_vm_name(snapshot_id)
        if await lume.find(snapshot_vm) is None:
            return
        await lume.delete(snapshot_vm)


@app.post("/sandboxes/{sandbox_id}/execute", status_code=200)
async def execute_sandbox(sandbox_id: str, body: ExecuteInput) -> dict:
    async with vm_lock(sandbox_id):
        return {"output": await lume.execute(sandbox_id, body.command)}


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


async def websocket_to_pty(websocket: WebSocket, master: int) -> None:
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
        if message.get("bytes") is not None:
            os.write(master, message["bytes"])
        elif message.get("text") is not None:
            with contextlib.suppress(Exception):
                control = json.loads(message["text"])
                resize = control.get("resize")
                if resize:
                    _set_winsize(master, int(resize["rows"]), int(resize["cols"]))


async def pty_to_websocket(master: int, websocket: WebSocket) -> None:
    loop = asyncio.get_running_loop()
    while True:
        try:
            content = await loop.run_in_executor(None, os.read, master, 64 * 1024)
        except OSError:
            return
        if not content:
            return
        await websocket.send_bytes(content)


@app.websocket("/sandboxes/{sandbox_id}/ssh")
async def ssh_sandbox(websocket: WebSocket, sandbox_id: str) -> None:
    try:
        if await lume.find(sandbox_id) is None:
            await websocket.close(code=1008, reason="sandbox not found")
            return
        address = await lume.ip(sandbox_id)
    except NodeOperationError as error:
        await websocket.close(code=1011, reason=str(error))
        return

    await websocket.accept()

    # The optional first text frame sets the terminal type and size.
    # Limit TERM to entries available in the macOS guest.
    SAFE_TERMS = {"xterm", "xterm-256color", "screen", "screen-256color", "tmux", "tmux-256color", "vt100", "ansi"}
    term = "xterm-256color"
    rows, cols = 24, 80
    initial_input = b""
    with contextlib.suppress(TimeoutError, asyncio.TimeoutError):
        first = await asyncio.wait_for(websocket.receive(), timeout=2)
        if first["type"] == "websocket.disconnect":
            return
        if first.get("text") is not None:
            with contextlib.suppress(Exception):
                control = json.loads(first["text"])
                requested = str(control.get("term") or term)
                term = requested if requested in SAFE_TERMS else "xterm-256color"
                resize = control.get("resize") or {}
                rows = int(resize.get("rows") or rows)
                cols = int(resize.get("cols") or cols)
        elif first.get("bytes") is not None:
            initial_input = first["bytes"]

    print(f"[ssh] session {sandbox_id}: term={term} size={cols}x{rows} init={'control' if not initial_input else 'data'}", flush=True)
    master, slave = pty.openpty()
    _set_winsize(master, rows, cols)

    def make_controlling_tty() -> None:
        os.setsid()
        # Opening the PTY after setsid makes it the controlling terminal on macOS.
        try:
            fd = os.open(os.ttyname(0), os.O_RDWR)
            os.close(fd)
        except OSError:
            pass

    try:
        process = await asyncio.create_subprocess_exec(
            "ssh",
            *lume.SSH_OPTIONS,
            "-o",
            "ConnectTimeout=10",
            "-tt",
            f"{config.SSH_USER}@{address}",
            stdin=slave,
            stdout=slave,
            stderr=slave,
            env={**os.environ, "TERM": term},
            preexec_fn=make_controlling_tty,
        )
    except OSError as error:
        os.close(master)
        os.close(slave)
        await websocket.close(code=1011, reason=str(error))
        return
    os.close(slave)
    if initial_input:
        os.write(master, initial_input)

    input_task = asyncio.create_task(websocket_to_pty(websocket, master))
    output_task = asyncio.create_task(pty_to_websocket(master, websocket))
    wait_task = asyncio.create_task(process.wait())
    try:
        done, pending = await asyncio.wait(
            (input_task, output_task, wait_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        for task in done | pending:
            with contextlib.suppress(
                asyncio.CancelledError,
                RuntimeError,
                WebSocketDisconnect,
            ):
                await task
    finally:
        with contextlib.suppress(OSError):
            os.close(master)
        if process.returncode is None:
            process.terminate()
            await process.wait()
        with contextlib.suppress(RuntimeError):
            await websocket.close(code=1000)


@app.post("/sandboxes/{sandbox_id}/launch-config", status_code=204)
async def run_launch_config(sandbox_id: str, body: LaunchConfigIn) -> None:
    setup = [] if body.setup is None else ([body.setup] if isinstance(body.setup, str) else body.setup)
    cd_project = (
        f"base={shlex.quote(config.GUEST_DIR)}; "
        "project=$base; "
        "entries=$(find \"$base\" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' '); "
        "first=$(find \"$base\" -mindepth 1 -maxdepth 1 -type d | head -n 1); "
        "if [ \"$entries\" = \"1\" ] && [ -n \"$first\" ]; then project=$first; fi; "
        "cd \"$project\""
    )

    async with vm_lock(sandbox_id):
        for command in setup:
            if not command.strip():
                raise HTTPException(422, "launch config setup commands must be non-empty")
            await lume.execute(sandbox_id, f"/bin/zsh -lc {shlex.quote(f'{cd_project} && {command}')}")
        if body.start:
            command = f"nohup /bin/zsh -lc {shlex.quote(body.start)} >/tmp/cider-start.log 2>&1 </dev/null &"
            await lume.execute(sandbox_id, f"/bin/zsh -lc {shlex.quote(f'{cd_project} && {command}')}")


@app.delete("/sandboxes/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str) -> None:
    async with vm_lock(sandbox_id):
        await lume.delete(sandbox_id)


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=config.NODE_PORT, reload=False)
