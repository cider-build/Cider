import uuid

from sqlmodel import Field, SQLModel


class Node(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    name: str = Field(unique=True, index=True)
    url: str
