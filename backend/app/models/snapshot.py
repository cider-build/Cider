import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class Snapshot(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    source_sandbox_id: str = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
