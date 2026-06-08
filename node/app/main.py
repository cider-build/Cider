from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import tart

app = FastAPI(title="Cider Node")


class CreateSandboxIn(BaseModel):
    id: str | None = None


@app.post("/sandboxes", status_code=201)
async def create_sandbox(body: CreateSandboxIn) -> dict:
    try:
        return {"id": await tart.create(body.id)}
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@app.delete("/sandboxes/{sandbox_id}", status_code=204)
async def delete_sandbox(sandbox_id: str) -> None:
    try:
        await tart.delete(sandbox_id)
    except RuntimeError as e:
        raise HTTPException(500, str(e))


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=False)
