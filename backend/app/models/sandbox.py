import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class Sandbox(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    node_id: str = Field(foreign_key="node.id", index=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
    deleted_at: datetime | None = None
