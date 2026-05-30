import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

from . import config, tart
from .warm_pool import WarmPool

log = logging.getLogger(__name__)


class CreateIn(BaseModel):
    # Optional: callers can pin a specific id (testing/debug). When omitted
    # (the normal flow from the backend), the node picks one — usually from
    # the warm pool. If no warm sandbox is ready, it creates one synchronously.
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
    base_vm: str
    base_ready: bool
    warm: int


class SandboxStateOut(BaseModel):
    id: str
    running: bool


class ListOut(BaseModel):
    # Excludes warm-pool ids: the backend should never see warm VMs as orphans.
    items: list[SandboxStateOut]


_warm_pool = WarmPool()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Reconcile with the world: adopt persisted warm ids that are still alive,
    # kill anything else we don't recognize (orphans from a crash/reload).
    await _warm_pool.adopt_or_clean()
    pool_tasks: list[asyncio.Task[None]] = []
    if await tart.base_ready():
        log.info("startup: base Tart VM present, starting warm pool tasks")
        pool_tasks = [
            asyncio.create_task(_warm_pool.top_up()),
            asyncio.create_task(_warm_pool.maintain()),
        ]
    else:
        log.warning(
            "startup: base Tart VM %s missing — warm pool disabled, "
            "every /sandboxes call will cold-spawn (slow)",
            config.BASE_VM,
        )
    try:
        yield
    finally:
        for t in pool_tasks:
            t.cancel()
        for t in pool_tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        # Don't kill warm VMs on shutdown — the persisted ids let the next
        # process re-adopt them. Faster dev-loop, no cold-spawn churn.


app = FastAPI(title="Cider Node", lifespan=lifespan)


def _tart_error(e: tart.TartError) -> HTTPException:
    return HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"tart: {e}")


async def _active_count() -> int:
    sandboxes = await tart.list_sandboxes()
    return sum(1 for s in sandboxes if s.running)


@app.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    try:
        running = await _active_count()
        base_ready = await tart.base_ready()
    except tart.TartError as e:
        raise _tart_error(e)
    warm_ready = len(_warm_pool.warm_ids())
    # Subtract everything the pool owns (ready + still-booting) to get
    # what the user actually sees as a live sandbox.
    user_active = max(0, running - _warm_pool.occupied_slots())
    return HealthOut(
        ok=True,
        active=user_active,
        capacity=config.MAX_SANDBOXES,
        base_vm=config.BASE_VM,
        base_ready=base_ready,
        warm=warm_ready,
    )


@app.get("/sandboxes", response_model=ListOut)
async def list_user_sandboxes() -> ListOut:
    """Sandboxes the backend should see — Tart's view minus warm-pool VMs.

    The backend uses this to reconcile its DB against ground truth: anything
    backend thinks is running but doesn't appear here (or appears with
    running=false) gets marked stopped. We exclude both ready warm VMs AND
    ids that are mid-spawn — otherwise the reconciler reaps every cold-spawn
    before it finishes booting (typically before DHCP even completes).
    """
    try:
        all_sandboxes = await tart.list_sandboxes()
    except tart.TartError as e:
        raise _tart_error(e)
    pool_owned = _warm_pool.claimed_ids()
    return ListOut(
        items=[
            SandboxStateOut(id=s.id, running=s.running)
            for s in all_sandboxes
            if s.id not in pool_owned
        ]
    )


@app.post("/sandboxes", response_model=CreateOut, status_code=status.HTTP_201_CREATED)
async def create_sandbox(body: CreateIn) -> CreateOut:
    started = time.monotonic()
    log.info("POST /sandboxes received (pinned_id=%s)", body.id)
    try:
        base_ready = await tart.base_ready()
    except tart.TartError as e:
        raise _tart_error(e)
    if not base_ready:
        log.warning("POST /sandboxes 503: base Tart VM missing")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"base Tart VM not found: {config.BASE_VM}",
        )

    if body.id is None:
        # Normal flow: let the warm pool pick (instant if a warm one's ready).
        try:
            sandbox_id = await _warm_pool.acquire()
        except tart.TartError as e:
            raise _tart_error(e)
    else:
        # Caller pinned a specific id — clone fresh and boot.
        if not body.id.startswith(config.SANDBOX_PREFIX):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"sandbox id must start with {config.SANDBOX_PREFIX!r}",
            )
        if await _active_count() >= config.MAX_SANDBOXES:
            log.warning("POST /sandboxes 409: at capacity (max=%d)", config.MAX_SANDBOXES)
            raise HTTPException(status.HTTP_409_CONFLICT, "node at capacity")
        try:
            await tart.clone(body.id)
        except tart.TartError as e:
            raise _tart_error(e)
        tart.spawn_run(body.id)
        sandbox_id = body.id

    log.info(
        "POST /sandboxes -> %s in %.2fs", sandbox_id, time.monotonic() - started
    )
    return CreateOut(id=sandbox_id)


@app.post("/sandboxes/{sandbox_id}/exec", response_model=ExecOut)
async def exec_in_sandbox(sandbox_id: str, body: ExecIn) -> ExecOut:
    try:
        result = await tart.exec_command(sandbox_id, body.command)
    except tart.TartError as e:
        raise _tart_error(e)
    return ExecOut(stdout=result.stdout, stderr=result.stderr, exit_code=result.exit_code)


@app.get("/sandboxes/{sandbox_id}/ip", response_model=IPOut)
async def sandbox_ip(sandbox_id: str) -> IPOut:
    try:
        address = await tart.ip(sandbox_id)
    except tart.TartError as e:
        raise _tart_error(e)
    return IPOut(ip=address)


@app.delete("/sandboxes/{sandbox_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sandbox(sandbox_id: str) -> None:
    try:
        await tart.delete(sandbox_id)
    except tart.TartError as e:
        raise _tart_error(e)
    # An active slot just freed up — refill the warm pool.
    asyncio.create_task(_warm_pool.release())


def run() -> None:
    import uvicorn

    # Surface app.* logger output (warm_pool, tart, this module) at INFO.
    # Uvicorn ships handlers for its own loggers but leaves the root alone, so
    # without this our INFO calls would be swallowed.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=False)
