import uuid

from sqlmodel import Field, SQLModel


class Node(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    org_id: str = Field(foreign_key="organization.id", index=True)
    name: str = Field(index=True)
    url: str
