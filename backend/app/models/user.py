from datetime import datetime

from sqlmodel import Field, SQLModel

from ._ids import new_id
from ._time import utcnow


class User(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    email: str = Field(unique=True, index=True)
    password_hash: str
    name: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
