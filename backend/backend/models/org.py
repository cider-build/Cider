from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel

from ._ids import new_id
from ._time import utcnow


class OrgRole(str, Enum):
    owner = "owner"
    member = "member"


class Org(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    slug: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utcnow)


class OrgMembership(SQLModel, table=True):
    user_id: str = Field(foreign_key="user.id", primary_key=True)
    org_id: str = Field(foreign_key="org.id", primary_key=True)
    role: OrgRole = Field(default=OrgRole.member)
    created_at: datetime = Field(default_factory=utcnow)
