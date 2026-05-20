import os
from datetime import datetime

from sqlmodel import Field, Session, SQLModel, create_engine

DB_URL = f"sqlite:///{os.environ.get('PROVISIONER_DB', 'provisioner.db')}"

engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


class Node(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    url: str
    last_ping_at: datetime | None = None
    last_ping_ok: bool | None = None


class Sandbox(SQLModel, table=True):
    id: str = Field(primary_key=True)
    node_id: int = Field(foreign_key="node.id")
    created_at: datetime


def init() -> None:
    SQLModel.metadata.create_all(engine)


def session():
    with Session(engine) as s:
        yield s
