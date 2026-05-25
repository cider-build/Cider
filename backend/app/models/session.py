from datetime import datetime

from sqlmodel import Field, SQLModel

from ._time import utcnow


class Session(SQLModel, table=True):
    token: str = Field(primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    expires_at: datetime
    created_at: datetime = Field(default_factory=utcnow)
