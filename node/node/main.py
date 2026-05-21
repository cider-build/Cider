from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

from . import ciderctl, config


class CreateIn(BaseModel):
    id: str


class ExecIn(BaseModel):
    command: str


class CreateOut(BaseModel):
    id: str


class ExecOut(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


class IPOut(BaseModel):
    ip: str


class HealthOut(BaseModel):
    ok: bool
    active: int
    capacity: int
    base_bundle: str
    base_ready: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Cider Node", lifespan=lifespan)


def _ctl_error(e: ciderctl.CtlError) -> HTTPException:
    return HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"ciderctl: {e}")


def _bootstrap_marker() -> Path:
    return Path(config.BASE_BUNDLE, "bootstrap.marker")


async def _active_count() -> int:
    sandboxes = await ciderctl.list_sandboxes()
    return sum(1 for s in sandboxes if s.running)


@app.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    try:
        active = await _active_count()
    except ciderctl.CtlError:
        active = 0
    return HealthOut(
        ok=True,
        active=active,
        capacity=config.MAX_SANDBOXES,
        base_bundle=config.BASE_BUNDLE,
        base_ready=_bootstrap_marker().exists(),
    )


@app.post("/sandboxes", response_model=CreateOut, status_code=status.HTTP_201_CREATED)
async def create_sandbox(body: CreateIn) -> CreateOut:
    if not _bootstrap_marker().exists():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"base bundle not bootstrapped yet; run `ciderctl bootstrap {config.BASE_BUNDLE}` first",
        )

    if await _active_count() >= config.MAX_SANDBOXES:
        raise HTTPException(status.HTTP_409_CONFLICT, "node at capacity")

    try:
        await ciderctl.clone(body.id)
    except ciderctl.CtlError as e:
        raise _ctl_error(e)

    ciderctl.spawn_run(body.id)
    return CreateOut(id=body.id)


@app.post("/sandboxes/{sandbox_id}/exec", response_model=ExecOut)
async def exec_in_sandbox(sandbox_id: str, body: ExecIn) -> ExecOut:
    try:
        result = await ciderctl.exec_command(sandbox_id, body.command)
    except ciderctl.CtlError as e:
        raise _ctl_error(e)
    return ExecOut(stdout=result.stdout, stderr=result.stderr, exit_code=result.exit_code)


@app.get("/sandboxes/{sandbox_id}/ip", response_model=IPOut)
async def sandbox_ip(sandbox_id: str) -> IPOut:
    try:
        address = await ciderctl.ip(sandbox_id)
    except ciderctl.CtlError as e:
        raise _ctl_error(e)
    return IPOut(ip=address)


@app.delete("/sandboxes/{sandbox_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sandbox(sandbox_id: str) -> None:
    try:
        await ciderctl.delete(sandbox_id)
    except ciderctl.CtlError as e:
        raise _ctl_error(e)


def run() -> None:
    import uvicorn

    uvicorn.run("node.main:app", host="0.0.0.0", port=8001, reload=False)
