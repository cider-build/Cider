from datetime import datetime

from sqlalchemy import JSON, Column, Index
from sqlmodel import Field, SQLModel

from .base import new_id, utc_now


class Server(SQLModel, table=True):
    __table_args__ = (
        Index("uq_server_org_id_name", "org_id", "name", unique=True),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    org_id: str = Field(foreign_key="organization.id", index=True)
    node_id: str = Field(foreign_key="node.id", index=True)
    name: str = Field(index=True)
    vm_id: str = Field(index=True)
    image: dict | None = Field(default=None, sa_column=Column(JSON))
    status: str = Field(default="provisioning", index=True)
    status_detail: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    deleted_at: datetime | None = None
