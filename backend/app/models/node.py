from datetime import datetime

from sqlmodel import Field, SQLModel

from ._ids import new_id
from ._time import utcnow


class Node(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    org_id: str = Field(foreign_key="org.id", index=True)
    name: str
    url: str
    created_at: datetime = Field(default_factory=utcnow)
    last_ping_at: datetime | None = None
    last_ping_ok: bool | None = None
