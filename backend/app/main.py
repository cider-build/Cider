import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import reconciler
from .config import settings
from .db import init_db
from .routers import auth, nodes, orgs, sandboxes, waitlist


class HealthCheckOut(BaseModel):
    ok: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(reconciler.run_forever())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Cider Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(orgs.router)
app.include_router(nodes.router)
app.include_router(sandboxes.router)
app.include_router(waitlist.router)


@app.get("/health", response_model=HealthCheckOut)
def health_check() -> HealthCheckOut:
    return HealthCheckOut(ok=True)


def run() -> None:
    import uvicorn

    # Surface app.* logger output (node_client, reconciler, routers) at INFO.
    # Uvicorn handles its own loggers but leaves the root alone, so without
    # this our INFO calls would be swallowed.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
