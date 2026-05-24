from collections.abc import Iterator

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

from .config import settings

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)


# Columns added to existing tables after first deploy. SQLModel's create_all
# only handles new tables, so for additive changes on the dev SQLite DB we
# fall back to a tiny in-process migration table.
_ADDITIVE_COLUMNS: list[tuple[str, str, str]] = [
    ("sandbox", "last_seen_at", "DATETIME"),
    ("sandbox", "stopped_reason", "VARCHAR"),
    ("sandbox", "stopped_at", "DATETIME"),
]


def _apply_additive_columns() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        for table, column, col_type in _ADDITIVE_COLUMNS:
            existing = {row[1] for row in conn.execute(text(f'PRAGMA table_info("{table}")'))}
            if column not in existing:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {col_type}'))


def init_db() -> None:
    # Importing models registers them with SQLModel.metadata.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _apply_additive_columns()


def get_session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s
