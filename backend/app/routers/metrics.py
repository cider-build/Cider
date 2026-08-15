from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select

from ..auth import AuthContext, current_auth_context
from ..db import get_session
from ..models import ResourceMetric, Sandbox, Server
from ..models.base import utc_now
from ..services.resource_metrics import SAMPLE_INTERVAL_SECONDS

router = APIRouter()

MetricWindow = Literal["live", "1h", "24h"]
WINDOW_DURATION = {
    "live": timedelta(minutes=10),
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
}


class MetricSampleOut(BaseModel):
    cpu_percent: float
    memory_percent: float
    graphics_memory_bytes: int
    collected_at: datetime


class MetricHistoryOut(BaseModel):
    sampling_interval_seconds: int
    samples: list[MetricSampleOut]


def metric_history(org_id: str, resource_kind: str, resource_id: str, window: MetricWindow) -> MetricHistoryOut:
    cutoff = utc_now() - WINDOW_DURATION[window]
    with get_session() as db:
        samples = db.exec(
            select(ResourceMetric)
            .where(
                ResourceMetric.org_id == org_id,
                ResourceMetric.resource_kind == resource_kind,
                ResourceMetric.resource_id == resource_id,
                ResourceMetric.collected_at >= cutoff,
            )
            .order_by(ResourceMetric.collected_at)
        ).all()
    return MetricHistoryOut(
        sampling_interval_seconds=SAMPLE_INTERVAL_SECONDS,
        samples=[
            MetricSampleOut(
                cpu_percent=sample.cpu_percent,
                memory_percent=sample.memory_percent,
                graphics_memory_bytes=sample.graphics_memory_bytes,
                collected_at=sample.collected_at.replace(tzinfo=timezone.utc),
            )
            for sample in samples
        ],
    )


@router.get("/sandboxes/{sandbox_id}/metrics", response_model=MetricHistoryOut)
async def sandbox_metrics(
    sandbox_id: str,
    window: MetricWindow = Query("live"),
    ctx: AuthContext = Depends(current_auth_context),
) -> MetricHistoryOut:
    with get_session() as db:
        sandbox = db.get(Sandbox, sandbox_id)
        if sandbox is None or sandbox.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "sandbox not found")
    return metric_history(ctx.membership.organization_id, "sandbox", sandbox_id, window)


@router.get("/servers/{server_id}/metrics", response_model=MetricHistoryOut)
async def server_metrics(
    server_id: str,
    window: MetricWindow = Query("live"),
    ctx: AuthContext = Depends(current_auth_context),
) -> MetricHistoryOut:
    with get_session() as db:
        server = db.get(Server, server_id)
        if server is None or server.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "server not found")
    return metric_history(ctx.membership.organization_id, "server", server_id, window)
