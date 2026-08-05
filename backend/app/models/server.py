import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, JSON, Index
from sqlmodel import Field, SQLModel


class Server(SQLModel, table=True):
    """A long-running, named VM — the durable counterpart to throwaway sandboxes.

    Servers survive restarts: `stopped` keeps the VM on the node's disk without
    holding one of its scarce running-VM slots.
    """

    __table_args__ = (
        Index("uq_server_org_id_name", "org_id", "name", unique=True),
    )

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    org_id: str = Field(foreign_key="organization.id", index=True)
    node_id: str = Field(foreign_key="node.id", index=True)
    name: str = Field(index=True)
    vm_id: str = Field(index=True)
    image: dict | None = Field(default=None, sa_column=Column(JSON))
    status: str = Field(default="provisioning", index=True)
    status_detail: str | None = None
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
    deleted_at: datetime | None = None
