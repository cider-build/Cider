import asyncio
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

from . import ciderctl, config
from .warm_pool import WarmPool


class CreateIn(BaseModel):
    # Optional: callers can pin a specific id (testing/debug). When omitted
    # (the normal flow from the backend), the node picks one — usually from
    # the warm pool, falling back to a fresh clone.
    id: str | None = None


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
    warm: int


_warm_pool = WarmPool()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Reconcile with the world: adopt persisted warm ids that are still alive,
    # kill anything else we don't recognize (orphans from a crash/reload).
    await _warm_pool.adopt_or_clean()
    # Kick off the initial pool fill + periodic self-heal loop.
    top_up_task = asyncio.create_task(_warm_pool.top_up())
    maintain_task = asyncio.create_task(_warm_pool.maintain())
    try:
        yield
    finally:
        for t in (top_up_task, maintain_task):
            t.cancel()
        for t in (top_up_task, maintain_task):
            with contextlib.suppress(asyncio.CancelledError):
                await t
        # Don't kill warm VMs on shutdown — the persisted ids let the next
        # process re-adopt them. Faster dev-loop, no cold-spawn churn.


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
        running = await _active_count()
    except ciderctl.CtlError:
        running = 0
    warm_ready = len(_warm_pool.warm_ids())
    # Subtract everything the pool owns (ready + still-booting) to get
    # what the user actually sees as a live sandbox.
    user_active = max(0, running - _warm_pool.occupied_slots())
    return HealthOut(
        ok=True,
        active=user_active,
        capacity=config.MAX_SANDBOXES,
        base_bundle=config.BASE_BUNDLE,
        base_ready=_bootstrap_marker().exists(),
        warm=warm_ready,
    )


@app.post("/sandboxes", response_model=CreateOut, status_code=status.HTTP_201_CREATED)
async def create_sandbox(body: CreateIn) -> CreateOut:
    if not _bootstrap_marker().exists():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"base bundle not bootstrapped yet; run `ciderctl bootstrap {config.BASE_BUNDLE}` first",
        )

    if body.id is None:
        # Normal flow: let the warm pool pick (instant if a warm one's ready).
        try:
            sandbox_id = await _warm_pool.acquire()
        except ciderctl.CtlError as e:
            raise _ctl_error(e)
    else:
        # Caller pinned a specific id — clone fresh and boot. Mostly here for
        # back-compat with scripts that want determinism.
        if await _active_count() >= config.MAX_SANDBOXES:
            raise HTTPException(status.HTTP_409_CONFLICT, "node at capacity")
        try:
            await ciderctl.clone(body.id)
        except ciderctl.CtlError as e:
            raise _ctl_error(e)
        ciderctl.spawn_run(body.id)
        sandbox_id = body.id

    return CreateOut(id=sandbox_id)


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
    # An active slot just freed up — refill the warm pool.
    asyncio.create_task(_warm_pool.release())


def run() -> None:
    import uvicorn

    uvicorn.run("node.main:app", host="0.0.0.0", port=8001, reload=False)
