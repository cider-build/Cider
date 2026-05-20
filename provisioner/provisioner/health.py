import asyncio
import os
from datetime import datetime, timezone

import httpx
from sqlmodel import Session, select

from .models import Node, engine

PING_INTERVAL = float(os.environ.get("PING_INTERVAL_SECONDS", "10"))
PING_TIMEOUT = float(os.environ.get("PING_TIMEOUT_SECONDS", "3"))


async def _ping(client: httpx.AsyncClient, url: str) -> bool:
    try:
        r = await client.get(f"{url.rstrip('/')}/health", timeout=PING_TIMEOUT)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


async def _tick(client: httpx.AsyncClient) -> None:
    with Session(engine) as db:
        targets = [(n.id, n.url) for n in db.exec(select(Node)).all()]

    results = await asyncio.gather(*(_ping(client, url) for _, url in targets))
    now = datetime.now(timezone.utc)

    with Session(engine) as db:
        for (node_id, _), ok in zip(targets, results):
            node = db.get(Node, node_id)
            if node:
                node.last_ping_at = now
                node.last_ping_ok = ok
                db.add(node)
        db.commit()


async def run_forever() -> None:
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await _tick(client)
            except Exception as e:
                print(f"[health] tick failed: {e}")
            await asyncio.sleep(PING_INTERVAL)
