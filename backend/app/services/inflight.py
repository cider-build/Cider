"""Track server lifecycle tasks in this process."""

from collections.abc import Awaitable

_active: set[str] = set()


def is_active(server_id: str) -> bool:
    return server_id in _active


async def guarded(server_id: str, work: Awaitable[None]) -> None:
    _active.add(server_id)
    try:
        await work
    finally:
        _active.discard(server_id)
