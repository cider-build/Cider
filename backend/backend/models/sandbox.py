from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel

from ._ids import new_id
from ._time import utcnow


class SandboxStatus(str, Enum):
    pending = "pending"
    running = "running"
    deleted = "deleted"
    failed = "failed"


class Sandbox(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    org_id: str = Field(foreign_key="org.id", index=True)
    node_id: str = Field(foreign_key="node.id", index=True)
    status: SandboxStatus = Field(default=SandboxStatus.pending)
    created_at: datetime = Field(default_factory=utcnow)
    deleted_at: datetime | None = None
