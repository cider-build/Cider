from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC datetime. SQLite drops tzinfo on round-trip, so we store naive."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
