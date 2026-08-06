import uuid
from datetime import datetime, timezone


def new_id() -> str:
    return uuid.uuid4().hex


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
