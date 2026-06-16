import os
from collections.abc import AsyncIterator
from pathlib import Path

from .config import settings


Path(settings.snapshot_dir).mkdir(parents=True, exist_ok=True)


def snapshot_path(id: str) -> str:
    return os.path.join(settings.snapshot_dir, f"{id}.tgz")


def delete_snapshot(id: str) -> None:
    for ext in ("tgz", "aar"):
        path = os.path.join(settings.snapshot_dir, f"{id}.{ext}")
        if os.path.exists(path):
            os.unlink(path)


async def save_snapshot(id: str, chunks: AsyncIterator[bytes]) -> None:
    with open(snapshot_path(id), "wb") as file:
        async for chunk in chunks:
            file.write(chunk)
