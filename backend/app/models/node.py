from datetime import datetime

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

from .base import new_id, utc_now


class Node(SQLModel, table=True):
    __table_args__ = (
        Index("uq_node_org_id_name", "org_id", "name", unique=True),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    org_id: str = Field(foreign_key="organization.id", index=True)
    name: str = Field(index=True)
    hardware_model: str | None = None
    chip: str | None = None
    macos_version: str | None = None
    cpu_count: int | None = None
    memory_bytes: int | None = None
    storage_total_bytes: int | None = None
    storage_available_bytes: int | None = None
    vm_count: int = 2
    sandbox_cpu_count: int | None = None
    sandbox_memory_bytes: int | None = None
    sandbox_storage_bytes: int | None = None


class NodeCredential(SQLModel, table=True):
    node_id: str = Field(foreign_key="node.id", primary_key=True)
    token_hash: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utc_now)
