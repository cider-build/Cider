from datetime import datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

from .base import new_id, utc_now


class Sandbox(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    node_id: str = Field(foreign_key="node.id", index=True)
    org_id: str | None = Field(default=None, foreign_key="organization.id", index=True)
    launch_config: dict | None = Field(default=None, sa_column=Column(JSON))
    storage_used_bytes: int | None = None
    status: str = Field(default="active", index=True)
    created_at: datetime = Field(default_factory=utc_now)
    deleted_at: datetime | None = None
