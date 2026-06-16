import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class WaitlistEntry(SQLModel, table=True):
    __tablename__ = "waitlist"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    email: str = Field(unique=True, index=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
