import asyncio
import logging

import httpx
from fastapi import status
from sqlmodel import Session as DbSession
from sqlmodel import select

from .config import settings
from .db import engine
from .models import Node
from .models._time import utcnow

log = logging.getLogger(__name__)


async def _ping(client: httpx.AsyncClient, url: str) -> bool:
    try:
        r = await client.get(
            f"{url.rstrip('/')}/health", timeout=settings.health_ping_timeout_seconds
        )
        return r.status_code == status.HTTP_200_OK
    except httpx.HTTPError:
        return False


async def _tick(client: httpx.AsyncClient) -> None:
    with DbSession(engine) as db:
        targets = [(n.id, n.url) for n in db.exec(select(Node)).all()]

    if not targets:
        return

    results = await asyncio.gather(*(_ping(client, url) for _, url in targets))
    now = utcnow()

    with DbSession(engine) as db:
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
            except (httpx.HTTPError, OSError) as e:
                log.warning("health tick transport failure: %s", e)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("health tick crashed")
            await asyncio.sleep(settings.health_ping_interval_seconds)
