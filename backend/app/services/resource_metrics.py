import asyncio
import logging
from dataclasses import dataclass
from datetime import timedelta

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy import delete
from sqlmodel import select

from ..db import get_session
from ..models import Node, ResourceMetric, Sandbox, Server
from ..models.base import utc_now
from . import node_transport
from .node_gateway import node_gateway

logger = logging.getLogger(__name__)

SAMPLE_INTERVAL_SECONDS = 30
RETENTION_HOURS = 25


class MetricReading(BaseModel):
    cpu_percent: float
    memory_percent: float
    graphics_memory_bytes: int


@dataclass(frozen=True)
class MetricTarget:
    org_id: str
    node: Node
    resource_kind: str
    resource_id: str
    vm_id: str


async def collect_target(target: MetricTarget) -> None:
    try:
        response = await node_transport.request(
            target.node,
            "GET",
            f"/sandboxes/{target.vm_id}/metrics",
        )
        reading = MetricReading.model_validate(response.json())
    except (HTTPException, ValidationError) as error:
        logger.warning(
            "Metric collection failed for %s %s: %s",
            target.resource_kind,
            target.resource_id,
            error,
        )
        return

    with get_session() as db:
        db.add(ResourceMetric(
            org_id=target.org_id,
            node_id=target.node.id,
            resource_kind=target.resource_kind,
            resource_id=target.resource_id,
            **reading.model_dump(),
        ))
        db.commit()


async def collect_all() -> None:
    with get_session() as db:
        sandbox_rows = db.exec(
            select(Sandbox, Node)
            .join(Node, Sandbox.node_id == Node.id)
            .where(
                Sandbox.deleted_at.is_(None),
                Sandbox.org_id.is_not(None),
                Sandbox.status == "active",
            )
        ).all()
        server_rows = db.exec(
            select(Server, Node)
            .join(Node, Server.node_id == Node.id)
            .where(
                Server.deleted_at.is_(None),
                Server.status == "running",
            )
        ).all()

    targets = [
        MetricTarget(sandbox.org_id, node, "sandbox", sandbox.id, sandbox.id)
        for sandbox, node in sandbox_rows
        if sandbox.org_id is not None and node_gateway.is_connected(node.id)
    ] + [
        MetricTarget(server.org_id, node, "server", server.id, server.vm_id)
        for server, node in server_rows
        if node_gateway.is_connected(node.id)
    ]
    await asyncio.gather(*(collect_target(target) for target in targets))

    cutoff = utc_now() - timedelta(hours=RETENTION_HOURS)
    with get_session() as db:
        db.exec(delete(ResourceMetric).where(ResourceMetric.collected_at < cutoff))
        db.commit()
