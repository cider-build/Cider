from datetime import datetime

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

from .base import new_id, utc_now


class ResourceMetric(SQLModel, table=True):
    __table_args__ = (
        Index(
            "ix_resource_metric_history",
            "org_id",
            "resource_kind",
            "resource_id",
            "collected_at",
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    org_id: str = Field(foreign_key="organization.id", index=True)
    node_id: str = Field(foreign_key="node.id", index=True)
    resource_kind: str
    resource_id: str
    cpu_percent: float
    memory_percent: float
    graphics_memory_bytes: int
    collected_at: datetime = Field(default_factory=utc_now)
