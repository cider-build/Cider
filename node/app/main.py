import os
import tempfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from . import display, tart

app = FastAPI(title="Cider Node")


class ExecuteInput(BaseModel):
    command: str


@app.post("/sandboxes", status_code=201)
async def create_sandbox(archive: UploadFile | None = File(None)) -> dict:
    # current implementation writes to the OS, later on should explore other solutions
    sandbox_id = None
    archive_path = None
    try:
        sandbox_id = await tart.create()
        if archive is not None:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".tgz") as file:
                archive_path = file.name
                file.write(await archive.read())
            await tart.upload(sandbox_id, archive_path)
        return {"id": sandbox_id}
    except RuntimeError as e:
        if sandbox_id: await tart.delete(sandbox_id)
        raise HTTPException(500, str(e))
    finally:
        if archive_path is not None:
            os.unlink(archive_path)


@app.post("/sandboxes/{sandbox_id}/export")
async def export_sandbox(sandbox_id: str) -> FileResponse:
    archive_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tgz") as file:
            archive_path = file.name
        await tart.export(sandbox_id, archive_path)
        return FileResponse(archive_path, filename=f"{sandbox_id}.tgz", background=BackgroundTask(os.unlink, archive_path))
    except RuntimeError as e:
        if archive_path is not None:
            os.unlink(archive_path)
        raise HTTPException(500, str(e))


@app.post("/sandboxes/import", status_code=201)
async def import_sandbox(archive: UploadFile = File(...)) -> dict:
    archive_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tgz") as file:
            archive_path = file.name
            while chunk := await archive.read(1024 * 1024):
                file.write(chunk)
        return {"id": await tart.import_vm(archive_path)}
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    finally:
        if archive_path is not None:
            os.unlink(archive_path)


@app.post("/sandboxes/{sandbox_id}/execute", status_code=200)
async def execute_sandbox(sandbox_id: str, body: ExecuteInput) -> dict:
    try:
        return {"output": await tart.execute(sandbox_id, body.command)}
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@app.post("/sandboxes/{sandbox_id}/display", status_code=200)
async def open_display(sandbox_id: str) -> dict:
    try:
        session = await display.open_display(sandbox_id)
        return {
            "id": session.id,
            "protocol": "vnc",
            "transport": "tcp",
            "host": session.host,
            "port": session.port,
            "url": session.url,
            "username": display.config.DISPLAY_USERNAME,
            "password": display.config.DISPLAY_PASSWORD,
        }
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@app.delete("/display/{session_id}", status_code=204)
async def close_display(session_id: str) -> None:
    await display.close_display(session_id)


@app.delete("/sandboxes/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str) -> None:
    try:
        await display.close_sandbox_display(sandbox_id)
        await tart.delete(sandbox_id)
    except RuntimeError as e:
        raise HTTPException(500, str(e))


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=False)
