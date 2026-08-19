import asyncio
import gzip
import hashlib
import json
import os
import urllib.error
import urllib.request

from . import config, lume
from .errors import NodeOperationError


def _base_image_id() -> str:
    try:
        with open(config.BASE_IMAGE_ID_PATH) as file:
            image_id = file.read().strip()
    except FileNotFoundError as error:
        raise NodeOperationError(f"base image ID is missing: {config.BASE_IMAGE_ID_PATH}") from error
    if len(image_id) != 64 or any(character not in "0123456789abcdef" for character in image_id):
        raise NodeOperationError(f"base image ID is invalid: {config.BASE_IMAGE_ID_PATH}")
    return image_id


def _request(
    method: str,
    url: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    what: str = "Cider storage",
) -> bytes:
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise NodeOperationError(f"{what} {method} failed ({error.code}): {detail}") from error
    except urllib.error.URLError as error:
        raise NodeOperationError(f"{what} {method} failed: {error.reason}") from error


def _blob_url(digest: str, kind: str) -> str | None:
    """Ask the backend for a presigned object-store URL; the bytes never pass through it."""
    api_url, _, token = config.require_storage_config()
    body = _request(
        "GET",
        f"{api_url}/node-storage/blobs/{digest}/{kind}-url",
        headers={"Authorization": f"Bearer {token}"},
    )
    return json.loads(body)["url"]


def _put_blob(content: bytes) -> str:
    digest = hashlib.sha256(content).hexdigest()
    url = _blob_url(digest, "upload")
    if url is not None:
        _request(
            "PUT",
            url,
            content,
            headers={"Content-Type": "application/octet-stream"},
            what=f"blob {digest} upload",
        )
    return digest


def _get_blob(digest: str) -> bytes:
    url = _blob_url(digest, "download")
    if url is None:
        raise NodeOperationError(f"Cider storage returned no download URL for blob {digest}")
    content = _request("GET", url, what=f"blob {digest} download")
    if hashlib.sha256(content).hexdigest() != digest:
        raise NodeOperationError(f"Cider storage returned corrupt blob {digest}")
    return content


def _compressed_blob(content: bytes) -> tuple[str, int]:
    compressed = gzip.compress(content, compresslevel=1, mtime=0)
    return _put_blob(compressed), len(compressed)


def _export_files(sandbox_id: str, snapshot_id: str) -> dict:
    base_image_id = _base_image_id()
    source_root = config.vm_path(sandbox_id)
    base_root = config.vm_path(config.BASE_VM)
    source_disk_path = os.path.join(source_root, "disk.img")
    base_disk_path = os.path.join(base_root, "disk.img")
    disk_size = os.path.getsize(source_disk_path)
    if disk_size != os.path.getsize(base_disk_path):
        raise NodeOperationError("sandbox and base disk sizes differ")

    chunks = []
    uploaded_bytes = 0
    with open(source_disk_path, "rb", buffering=0) as source, open(base_disk_path, "rb", buffering=0) as base:
        for index, offset in enumerate(range(0, disk_size, config.SNAPSHOT_CHUNK_SIZE)):
            length = min(config.SNAPSHOT_CHUNK_SIZE, disk_size - offset)
            source_chunk = source.read(length)
            base_chunk = base.read(length)
            if len(source_chunk) != length or len(base_chunk) != length:
                raise NodeOperationError(f"short disk read at offset {offset}")
            if source_chunk == base_chunk:
                continue
            digest, stored_size = _compressed_blob(source_chunk)
            uploaded_bytes += stored_size
            chunks.append({
                "index": index,
                "length": length,
                "blob": digest,
            })
            if offset // (1024 * 1024 * 1024) != (offset + length) // (1024 * 1024 * 1024):
                print(
                    f"Portable snapshot {snapshot_id}: scanned {offset + length}/{disk_size} bytes, "
                    f"{len(chunks)} changed chunks",
                    flush=True,
                )

    return {
        "version": 2,
        "snapshot_id": snapshot_id,
        "base_image_id": base_image_id,
        "disk_size": disk_size,
        "chunk_size": config.SNAPSHOT_CHUNK_SIZE,
        "disk_chunks": chunks,
        "stored_bytes": uploaded_bytes,
    }


async def export(sandbox_id: str, snapshot_id: str) -> dict:
    await lume.execute(sandbox_id, "/bin/sync")
    await lume.stop(sandbox_id)
    return await asyncio.to_thread(_export_files, sandbox_id, snapshot_id)


def _restore_files(sandbox_id: str, manifest: dict) -> None:
    if manifest.get("version") != 2:
        raise NodeOperationError("unsupported portable snapshot version")
    if manifest.get("base_image_id") != _base_image_id():
        raise NodeOperationError(
            f"snapshot requires base image {manifest.get('base_image_id')}, "
            f"but this node has {_base_image_id()}"
        )

    root = config.vm_path(sandbox_id)
    disk_path = os.path.join(root, "disk.img")
    if os.path.getsize(disk_path) != manifest.get("disk_size"):
        raise NodeOperationError("destination base disk has the wrong size")
    chunk_size = manifest.get("chunk_size")
    if not isinstance(chunk_size, int) or chunk_size <= 0:
        raise NodeOperationError("snapshot chunk size is invalid")
    chunks = manifest.get("disk_chunks")
    if not isinstance(chunks, list):
        raise NodeOperationError("snapshot disk chunks are invalid")
    indexes = [chunk.get("index") for chunk in chunks if isinstance(chunk, dict)]
    if len(indexes) != len(chunks) or len(set(indexes)) != len(indexes):
        raise NodeOperationError("snapshot disk chunk indexes are invalid")
    with open(disk_path, "r+b", buffering=0) as disk:
        for chunk in chunks:
            index = chunk["index"]
            length = chunk.get("length")
            if (
                not isinstance(index, int)
                or index < 0
                or not isinstance(length, int)
                or length <= 0
                or length > chunk_size
                or index * chunk_size + length > manifest["disk_size"]
            ):
                raise NodeOperationError(f"snapshot chunk {index} is outside the disk")
            content = gzip.decompress(_get_blob(chunk["blob"]))
            if len(content) != length:
                raise NodeOperationError(f"snapshot chunk {index} has the wrong length")
            disk.seek(index * chunk_size)
            disk.write(content)
        disk.flush()
        os.fsync(disk.fileno())


async def restore(sandbox_id: str, manifest: dict) -> None:
    await lume.clone(config.BASE_VM, sandbox_id)
    try:
        await asyncio.to_thread(_restore_files, sandbox_id, manifest)
        await lume.start(sandbox_id)
    except BaseException:
        await lume.delete(sandbox_id)
        raise
