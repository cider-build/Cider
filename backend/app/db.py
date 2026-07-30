from sqlmodel import Session, SQLModel, create_engine

from .config import settings

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)


def get_session() -> Session:
    return Session(engine)


def session_dependency():
    with get_session() as session:
        yield session


def init_db() -> None:
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
