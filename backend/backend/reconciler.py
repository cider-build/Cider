"""Periodic reconciler between the backend's DB and each node's ground truth.

Every tick (~10s):
  1. Ping each registered node's /health.
  2. For reachable nodes: fetch /sandboxes (ciderctl truth minus warm pool),
     bump last_seen_at on rows we observe, mark missing/dead rows as stopped,
     and ask the node to reap any orphan VMs that don't belong to anyone.
  3. For unreachable nodes: leave sandboxes alone for now — they only get
     marked stopped once last_seen_at is older than the grace window. A
     brief blip never kills live sandboxes; a sustained outage clears them.

Why this exists: previously the backend trusted whatever `status` it wrote at
create time forever. A crashed node, a dead VM, a process restart — none of
that updated the dashboard. The UI would show "running" for sandboxes that
were obviously gone, and orphan VMs would leak across restarts past
warm_pool.adopt_or_clean()'s startup-only pass.
"""
import asyncio
import logging
from datetime import datetime, timedelta

import httpx
from fastapi import HTTPException, status
from sqlmodel import Session as DbSession
from sqlmodel import select

from . import node_client
from .config import settings
from .db import engine
from .models import ACTIVE_STATUSES, Node, Sandbox, SandboxStatus
from .models._time import utcnow
from .node_schema import NodeListResponse

log = logging.getLogger(__name__)


async def _ping(client: httpx.AsyncClient, url: str) -> bool:
    try:
        r = await client.get(
            f"{url.rstrip('/')}/health", timeout=settings.health_ping_timeout_seconds
        )
        return r.status_code == status.HTTP_200_OK
    except httpx.HTTPError:
        return False


async def _fetch_sandboxes(node_url: str) -> NodeListResponse | None:
    try:
        return await node_client.call(
            "GET", node_url, "/sandboxes", response_model=NodeListResponse
        )
    except HTTPException as e:
        log.warning("reconcile: /sandboxes on %s failed: %s", node_url, e.detail)
        return None


def _mark_stopped(sb: Sandbox, reason: str, now: datetime) -> None:
    sb.status = SandboxStatus.stopped
    sb.stopped_reason = reason
    sb.stopped_at = now


async def _reconcile_reachable(
    db: DbSession, node: Node, payload: NodeListResponse, now: datetime
) -> list[str]:
    """Sync DB sandboxes for one node against ciderctl truth. Returns the
    list of orphan ids the caller should ask the node to delete."""
    state_by_id = {s.id: s for s in payload.items}

    db_rows = db.exec(
        select(Sandbox).where(
            Sandbox.node_id == node.id, Sandbox.status.in_(ACTIVE_STATUSES)
        )
    ).all()

    for sb in db_rows:
        node_state = state_by_id.pop(sb.id, None)
        if node_state is None:
            # Backend thinks it's alive, node has no record — VM is gone.
            _mark_stopped(sb, "node has no record of this sandbox", now)
            db.add(sb)
        elif not node_state.running:
            # Node knows it exists but the run process is dead.
            _mark_stopped(sb, "vm is not running on node", now)
            db.add(sb)
        else:
            sb.last_seen_at = now
            db.add(sb)

    # Whatever's left in state_by_id is an orphan: node has a running VM but
    # the backend has no tracking row (or only terminal rows). Reap.
    return list(state_by_id.keys())


async def _reap_orphans(node_url: str, node_name: str, orphan_ids: list[str]) -> None:
    if not orphan_ids:
        return
    for oid in orphan_ids:
        try:
            await node_client.fire("DELETE", node_url, f"/sandboxes/{oid}")
            log.info("reaped orphan VM %s on node %s", oid, node_name)
        except HTTPException as e:
            # Don't crash the loop; we'll try again next tick.
            log.warning("reap %s on %s failed: %s", oid, node_name, e.detail)


async def _expire_unseen(db: DbSession, node: Node, now: datetime) -> None:
    """For an unreachable node: mark sandboxes whose last_seen_at is older
    than the grace window as stopped. Anything fresher gets the benefit of
    the doubt (transient blip)."""
    cutoff = now - timedelta(seconds=settings.sandbox_unseen_grace_seconds)
    stale = db.exec(
        select(Sandbox).where(
            Sandbox.node_id == node.id,
            Sandbox.status.in_(ACTIVE_STATUSES),
        )
    ).all()
    for sb in stale:
        # last_seen_at is None for sandboxes from before this field existed —
        # the grace window kicks in from `now` rather than retroactively
        # killing them. created_at gives us a sane fallback timestamp.
        anchor = sb.last_seen_at or sb.created_at
        if anchor and anchor < cutoff:
            _mark_stopped(sb, f"node {node.name} unreachable", now)
            db.add(sb)


async def _tick(client: httpx.AsyncClient) -> None:
    with DbSession(engine) as db:
        nodes = list(db.exec(select(Node)).all())

    if not nodes:
        return

    ping_results = await asyncio.gather(*(_ping(client, n.url) for n in nodes))
    now = utcnow()

    # Fetch sandbox lists in parallel only for reachable nodes — saves the
    # http call (and timeout window) on a dead node.
    list_tasks = [
        _fetch_sandboxes(n.url) if ok else asyncio.sleep(0, result=None)
        for n, ok in zip(nodes, ping_results)
    ]
    sandbox_lists = await asyncio.gather(*list_tasks)

    # (node_url, node_name, [orphan_id, ...]) — snapshotted out of the session
    # so we can do the reap calls after the session closes. Holding the Node
    # ORM instance past the session would raise DetachedInstanceError when we
    # try to read .url or .name later.
    orphan_work: list[tuple[str, str, list[str]]] = []

    with DbSession(engine) as db:
        for node, ok, payload in zip(nodes, ping_results, sandbox_lists):
            tracked = db.get(Node, node.id)
            if tracked is None:
                continue
            tracked.last_ping_at = now
            tracked.last_ping_ok = ok
            db.add(tracked)

            if ok and payload is not None:
                orphans = await _reconcile_reachable(db, tracked, payload, now)
                if orphans:
                    orphan_work.append((tracked.url, tracked.name, orphans))
            else:
                await _expire_unseen(db, tracked, now)
        db.commit()

    # Network calls outside the DB session so we don't hold the SQLite write
    # lock across orphan deletes. None of these affect our own DB state —
    # they just nudge the node to clean up.
    for url, name, orphans in orphan_work:
        await _reap_orphans(url, name, orphans)


async def run_forever() -> None:
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await _tick(client)
            except (httpx.HTTPError, OSError) as e:
                log.warning("reconcile tick transport failure: %s", e)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("reconcile tick crashed")
            await asyncio.sleep(settings.health_ping_interval_seconds)
