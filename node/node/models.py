import os
from datetime import datetime

from sqlmodel import Field, Session, SQLModel, create_engine

DB_URL = f"sqlite:///{os.environ.get('NODE_DB', 'node.db')}"

engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


class Sandbox(SQLModel, table=True):
    id: str = Field(primary_key=True)
    created_at: datetime
    status: str


def init() -> None:
    SQLModel.metadata.create_all(engine)


def session():
    with Session(engine) as s:
        yield s
