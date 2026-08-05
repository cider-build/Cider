from sqlmodel import Session, SQLModel, create_engine

from .config import settings

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)


def get_session() -> Session:
    # Sessions here are short-lived; keep attribute values readable after a
    # commit so instances can be returned from a closed session safely.
    return Session(engine, expire_on_commit=False)


def session_dependency():
    with get_session() as session:
        yield session


def init_db() -> None:
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
