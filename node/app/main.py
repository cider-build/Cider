import asyncio
import contextlib
import os
import shlex
import tempfile
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Path, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, StringConstraints

from . import config, lume, portable_snapshot

app = FastAPI(title="Cider Node")

SnapshotId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]

_vm_locks: dict[str, asyncio.Lock] = {}


def vm_lock(sandbox_id: str) -> asyncio.Lock:
    return _vm_locks.setdefault(sandbox_id, asyncio.Lock())


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}



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
    # current implementation writes to the OS, later on should explore other solutions
    sandbox_id = None
    archive_path = None
    try:
        sandbox_id = await lume.create()
        if archive is not None:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".tgz") as file:
                archive_path = file.name
                while chunk := await archive.read(1024 * 1024):
                    file.write(chunk)
            await lume.upload(sandbox_id, archive_path)
        return {"id": sandbox_id}
    except RuntimeError as e:
        if sandbox_id: await lume.delete(sandbox_id)
        raise HTTPException(500, str(e))
    finally:
        if archive_path is not None:
            os.unlink(archive_path)


@app.post("/sandboxes/{sandbox_id}/stop", status_code=204)
async def stop_sandbox(sandbox_id: str) -> None:
    async with vm_lock(sandbox_id):
        try:
            if await lume.find(sandbox_id) is None:
                raise HTTPException(404, "sandbox not found")
            await lume.stop(sandbox_id)
        except RuntimeError as e:
            raise HTTPException(500, str(e))


@app.post("/sandboxes/{sandbox_id}/start", status_code=204)
async def start_sandbox(sandbox_id: str) -> None:
    async with vm_lock(sandbox_id):
        try:
            vm = await lume.find(sandbox_id)
            if vm is None:
                raise HTTPException(404, "sandbox not found")
            if vm["status"] == "running":
                return
            await lume.start(sandbox_id)
        except RuntimeError as e:
            raise HTTPException(500, str(e))


@app.post("/sandboxes/{sandbox_id}/upload", status_code=204)
async def upload_sandbox(sandbox_id: str, archive: UploadFile = File(...)) -> None:
    archive_path = None
    async with vm_lock(sandbox_id):
        try:
            if await lume.find(sandbox_id) is None:
                raise HTTPException(404, "sandbox not found")
            with tempfile.NamedTemporaryFile(delete=False, suffix=".tgz") as file:
                archive_path = file.name
                while chunk := await archive.read(1024 * 1024):
                    file.write(chunk)
            await lume.upload(sandbox_id, archive_path)
        except RuntimeError as e:
            raise HTTPException(500, str(e))
        finally:
            if archive_path is not None:
                os.unlink(archive_path)


@app.post("/sandboxes/{sandbox_id}/snapshots", status_code=201)
async def snapshot_sandbox(sandbox_id: str, body: SnapshotInput) -> dict:
    async with vm_lock(sandbox_id):
        try:
            vm = await lume.find(sandbox_id)
        except RuntimeError as e:
            raise HTTPException(500, str(e))
        if vm is None:
            raise HTTPException(404, "sandbox not found")
        snapshot_vm = config.snapshot_vm_name(body.snapshot)

        try:
            await lume.snapshot(sandbox_id, snapshot_vm)
        except RuntimeError as e:
            raise HTTPException(500, f"live snapshot failed: {e}")
    return {"id": body.snapshot}


@app.post("/sandboxes/{sandbox_id}/portable-snapshots", status_code=201)
async def portable_snapshot_sandbox(sandbox_id: str, body: SnapshotInput) -> dict:
    async with vm_lock(sandbox_id):
        try:
            vm = await lume.find(sandbox_id)
            if vm is None:
                raise HTTPException(404, "sandbox not found")
            manifest = await portable_snapshot.export(sandbox_id, body.snapshot)
        except RuntimeError as e:
            raise HTTPException(500, f"portable snapshot failed: {e}")
    return {"id": body.snapshot, "manifest": manifest}


@app.post("/sandboxes/{sandbox_id}/restore", status_code=201)
async def restore_sandbox(sandbox_id: str, body: RestoreInput) -> dict:
    async with vm_lock(sandbox_id):
        try:
            if await lume.find(sandbox_id) is not None:
                raise HTTPException(409, "sandbox already exists on destination node")
            await portable_snapshot.restore(sandbox_id, body.manifest)
        except RuntimeError as e:
            raise HTTPException(500, f"portable restore failed: {e}")
    return {"id": sandbox_id}


@app.delete("/sandboxes/{sandbox_id}/snapshots/{snapshot_id}", status_code=204)
async def delete_snapshot(sandbox_id: str, snapshot_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]) -> None:
    async with vm_lock(sandbox_id):
        snapshot_vm = config.snapshot_vm_name(snapshot_id)
        try:
            if await lume.find(snapshot_vm) is None:
                return
            await lume.delete(snapshot_vm)
        except RuntimeError as e:
            raise HTTPException(500, str(e))


@app.post("/sandboxes/{sandbox_id}/execute", status_code=200)
async def execute_sandbox(sandbox_id: str, body: ExecuteInput) -> dict:
    async with vm_lock(sandbox_id):
        try:
            return {"output": await lume.execute(sandbox_id, body.command)}
        except RuntimeError as e:
            raise HTTPException(500, str(e))


async def websocket_to_process(
    websocket: WebSocket,
    process: asyncio.subprocess.Process,
) -> None:
    if process.stdin is None:
        raise RuntimeError("SSH process stdin is unavailable")
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
        if message.get("bytes") is None:
            raise RuntimeError("SSH tunnels only accept binary frames")
        process.stdin.write(message["bytes"])
        await process.stdin.drain()


async def process_to_websocket(
    process: asyncio.subprocess.Process,
    websocket: WebSocket,
) -> None:
    if process.stdout is None:
        raise RuntimeError("SSH process stdout is unavailable")
    while content := await process.stdout.read(64 * 1024):
        await websocket.send_bytes(content)


@app.websocket("/sandboxes/{sandbox_id}/ssh")
async def ssh_sandbox(websocket: WebSocket, sandbox_id: str) -> None:
    try:
        if await lume.find(sandbox_id) is None:
            await websocket.close(code=1008, reason="sandbox not found")
            return
        address = await lume.ip(sandbox_id)
        process = await asyncio.create_subprocess_exec(
            "ssh",
            *lume.SSH_OPTIONS,
            "-o",
            "ConnectTimeout=10",
            "-tt",
            f"{config.SSH_USER}@{address}",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except RuntimeError as error:
        await websocket.close(code=1011, reason=str(error))
        return

    await websocket.accept()
    input_task = asyncio.create_task(websocket_to_process(websocket, process))
    output_task = asyncio.create_task(process_to_websocket(process, websocket))
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
        if process.stdin is not None:
            process.stdin.close()
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
        try:
            for command in setup:
                if not command.strip():
                    raise HTTPException(422, "launch config setup commands must be non-empty")
                await lume.execute(sandbox_id, f"/bin/zsh -lc {shlex.quote(f'{cd_project} && {command}')}")
            if body.start:
                command = f"nohup /bin/zsh -lc {shlex.quote(body.start)} >/tmp/cider-start.log 2>&1 </dev/null &"
                await lume.execute(sandbox_id, f"/bin/zsh -lc {shlex.quote(f'{cd_project} && {command}')}")
        except RuntimeError as e:
            raise HTTPException(500, str(e))


@app.delete("/sandboxes/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str) -> None:
    async with vm_lock(sandbox_id):
        try:
            await lume.delete(sandbox_id)
        except RuntimeError as e:
            raise HTTPException(500, str(e))


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=config.NODE_PORT, reload=False)
