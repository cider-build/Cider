import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import auth, node_connections, node_storage, nodes, sandboxes, servers, snapshots, ssh, waitlist
from .services import reconciler
from .services.node_gateway import node_gateway

init_db()

app = FastAPI(title="Cider Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(node_connections.router)
app.include_router(node_storage.router)
app.include_router(nodes.router)
app.include_router(sandboxes.router)
app.include_router(servers.router)
app.include_router(snapshots.router)
app.include_router(ssh.router)
app.include_router(waitlist.router)


async def cleanup_loop() -> None:
    while True:
        await sandboxes.cleanup_expired_sandboxes()
        await asyncio.sleep(5)


async def reconcile_loop() -> None:
    while True:
        await reconciler.reconcile_all_nodes()
        await asyncio.sleep(10)


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(cleanup_loop())
    asyncio.create_task(reconcile_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    await node_gateway.close()


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
