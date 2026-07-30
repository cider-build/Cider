import hashlib
import json
import os
import tempfile
from pathlib import Path

from fastapi import HTTPException, Request

from .config import settings


def _org_root(org_id: str) -> Path:
    return Path(settings.snapshot_storage_path) / org_id


def blob_path(org_id: str, digest: str) -> Path:
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise HTTPException(422, "invalid blob digest")
    return _org_root(org_id) / "blobs" / digest


def manifest_path(org_id: str, snapshot_id: str) -> Path:
    return _org_root(org_id) / "manifests" / f"{snapshot_id}.json"


async def write_blob(org_id: str, digest: str, request: Request) -> None:
    destination = blob_path(org_id, digest)
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    file_descriptor, temporary_name = tempfile.mkstemp(dir=destination.parent)
    try:
        with os.fdopen(file_descriptor, "wb") as file:
            async for chunk in request.stream():
                hasher.update(chunk)
                file.write(chunk)
            file.flush()
            os.fsync(file.fileno())
        if hasher.hexdigest() != digest:
            raise HTTPException(422, "blob digest does not match its content")
        os.replace(temporary_name, destination)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def write_manifest(org_id: str, snapshot_id: str, manifest: dict) -> None:
    destination = manifest_path(org_id, snapshot_id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(dir=destination.parent)
    try:
        with os.fdopen(file_descriptor, "w") as file:
            json.dump(manifest, file, separators=(",", ":"), sort_keys=True)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary_name, destination)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def read_manifest(org_id: str, snapshot_id: str) -> dict:
    path = manifest_path(org_id, snapshot_id)
    if not path.exists():
        raise HTTPException(404, "snapshot manifest not found")
    with path.open() as file:
        return json.load(file)


def delete_manifest(org_id: str, snapshot_id: str) -> None:
    path = manifest_path(org_id, snapshot_id)
    if not path.exists():
        raise HTTPException(404, "snapshot manifest not found")
    path.unlink()


def discard_manifest(org_id: str, snapshot_id: str) -> None:
    manifest_path(org_id, snapshot_id).unlink(missing_ok=True)
