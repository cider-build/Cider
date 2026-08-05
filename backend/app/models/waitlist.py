from datetime import datetime

from sqlmodel import Field, SQLModel

from .base import new_id, utc_now


class WaitlistEntry(SQLModel, table=True):
    __tablename__ = "waitlist"

    id: str = Field(default_factory=new_id, primary_key=True)
    email: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utc_now)
