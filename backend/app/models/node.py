import uuid
from datetime import datetime, timezone

from sqlalchemy import Index
from sqlmodel import Field, SQLModel


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Node(SQLModel, table=True):
    __table_args__ = (
        Index("uq_node_org_id_name", "org_id", "name", unique=True),
    )

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    org_id: str = Field(foreign_key="organization.id", index=True)
    name: str = Field(index=True)


class NodeCredential(SQLModel, table=True):
    node_id: str = Field(foreign_key="node.id", primary_key=True)
    token_hash: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=now_utc)
