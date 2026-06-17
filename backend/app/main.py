import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .services import warm_pool
from .config import settings
from .db import init_db
from .routers import nodes, sandboxes, snapshots, waitlist

init_db()

app = FastAPI(title="Cider Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nodes.router)
app.include_router(sandboxes.router)
app.include_router(snapshots.router)
app.include_router(waitlist.router)


# later on, should implement a true queue-based TTL cleanup. simple implementation for now to work on other stuff
async def cleanup_loop() -> None:
    while True:
        await sandboxes.cleanup_expired_sandboxes()
        await asyncio.sleep(5)


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(cleanup_loop())
    await warm_pool.start()


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
