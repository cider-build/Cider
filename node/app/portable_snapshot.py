import asyncio
import fcntl
import gzip
import json
import struct
import hashlib
import os
import time
import http.client
import threading
import urllib.parse
import xxhash
from collections import deque
from compression import zstd
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.request

TRANSFER_WORKERS = int(os.environ.get("CIDER_TRANSFER_WORKERS", "6"))

from . import config, lume


def _base_image_id() -> str:
    try:
        with open(config.BASE_IMAGE_ID_PATH) as file:
            image_id = file.read().strip()
    except FileNotFoundError as error:
        raise RuntimeError(f"base image ID is missing: {config.BASE_IMAGE_ID_PATH}") from error
    if len(image_id) != 64 or any(character not in "0123456789abcdef" for character in image_id):
        raise RuntimeError(f"base image ID is invalid: {config.BASE_IMAGE_ID_PATH}")
    return image_id


_connections = threading.local()


def _keepalive_request(method: str, path: str, body: bytes | None = None) -> bytes:
    """Blob PUT/GET on a per-thread persistent connection (1,300 requests
    per export make per-request TCP setup real money)."""
    api_url, _, token = config.require_storage_config()
    parsed = urllib.parse.urlsplit(api_url)
    for attempt in range(2):
        connection = getattr(_connections, "conn", None)
        if connection is None:
            factory = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
            connection = factory(parsed.hostname, parsed.port, timeout=300)
            _connections.conn = connection
        try:
            connection.request(method, path, body=body, headers={"Authorization": f"Bearer {token}"})
            response = connection.getresponse()
            content = response.read()
            if response.status >= 400:
                raise RuntimeError(f"Cider storage {method} {path} failed ({response.status}): {content[:200]!r}")
            return content
        except (http.client.HTTPException, OSError):
            _connections.conn = None
            if attempt == 1:
                raise
    raise RuntimeError("unreachable")


def _request(method: str, path: str, body: bytes | None = None) -> bytes:
    api_url, _, token = config.require_storage_config()
    request = urllib.request.Request(
        f"{api_url}{path}",
        data=body,
        method=method,
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"Cider storage {method} {path} failed ({error.code}): {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cider storage {method} {path} failed: {error.reason}") from error


def _blob_exists(digest: str) -> bool:
    api_url, _, token = config.require_storage_config()
    request = urllib.request.Request(
        f"{api_url}/node-storage/blobs/{digest}",
        method="HEAD",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300):
            return True
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"Cider storage HEAD failed ({error.code}): {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cider storage HEAD failed: {error.reason}") from error


def _put_blob(content: bytes) -> str:
    digest = hashlib.sha256(content).hexdigest()
    if not _blob_exists(digest):
        _keepalive_request("PUT", f"/node-storage/blobs/{digest}", content)
    return digest


def _get_blob(digest: str) -> bytes:
    content = _keepalive_request("GET", f"/node-storage/blobs/{digest}")
    if hashlib.sha256(content).hexdigest() != digest:
        raise RuntimeError(f"Cider storage returned corrupt blob {digest}")
    return content


def _compressed_blob(content: bytes) -> tuple[str, int]:
    compressed = zstd.compress(content, 3)
    return _put_blob(compressed), len(compressed)


def _decompress(blob: bytes, compression: str) -> bytes:
    if compression == "zstd":
        return zstd.decompress(blob)
    return gzip.decompress(blob)


def _base_hash_path() -> str:
    return os.path.join(config.VM_STORAGE, f"{config.BASE_VM}.chunk-hashes.json")


def _load_base_hashes(base_image_id: str, chunk_size: int) -> list | None:
    try:
        with open(_base_hash_path()) as file:
            cache = json.load(file)
    except (OSError, ValueError):
        return None
    if cache.get("base_image_id") != base_image_id or cache.get("chunk_size") != chunk_size:
        return None
    return cache.get("hashes")


def _save_base_hashes(base_image_id: str, chunk_size: int, hashes: list) -> None:
    payload = json.dumps({"base_image_id": base_image_id, "chunk_size": chunk_size, "hashes": hashes})
    path = _base_hash_path()
    with open(path + ".tmp", "w") as file:
        file.write(payload)
    os.replace(path + ".tmp", path)


F_LOG2PHYS_EXT = 65
_LOG2PHYS = "=Iqq"  # packed: u32 flags, off_t contigbytes, off_t devoffset


def _phys_extents(path: str, size: int) -> list:
    """(logical, length, physical) runs; holes appear as gaps."""
    extents = []
    fd = os.open(path, os.O_RDONLY)
    try:
        offset = 0
        while offset < size:
            arg = struct.pack(_LOG2PHYS, 0, size - offset, offset)
            try:
                _, contig, dev = struct.unpack(_LOG2PHYS, fcntl.fcntl(fd, F_LOG2PHYS_EXT, arg))
            except OSError:
                # hole: jump to the next data region
                try:
                    offset = os.lseek(fd, offset, os.SEEK_DATA)
                    continue
                except (OSError, AttributeError):
                    break
            if contig <= 0:
                break
            extents.append((offset, contig, dev))
            offset += contig
    finally:
        os.close(fd)
    return extents


def _extent_changed_chunks(source_path: str, base_path: str, size: int, chunk_size: int) -> set:
    """Chunks whose bytes are not provably shared with the base.

    Copy-on-write guarantees a shared physical block is byte-identical, so
    the bias is safe: anything not shared gets uploaded.
    """
    source_extents = _phys_extents(source_path, size)
    base_extents = _phys_extents(base_path, size)
    if not source_extents or not base_extents:
        raise RuntimeError("no extent information")

    def coverage(extents):
        index = 0

        def at(offset):
            nonlocal index
            while index < len(extents) and extents[index][0] + extents[index][1] <= offset:
                index += 1
            if index < len(extents) and extents[index][0] <= offset:
                logical, length, dev = extents[index]
                return dev + (offset - logical), logical + length
            next_start = extents[index][0] if index < len(extents) else size
            return None, next_start

        return at

    source_at, base_at = coverage(source_extents), coverage(base_extents)
    changed = set()
    offset = 0
    while offset < size:
        source_phys, source_end = source_at(offset)
        base_phys, base_end = base_at(offset)
        end = min(source_end, base_end, size)
        shared = source_phys is not None and base_phys is not None and source_phys == base_phys
        hole_in_both = source_phys is None and base_phys is None
        if not (shared or hole_in_both):
            changed.update(range(offset // chunk_size, (end - 1) // chunk_size + 1))
        if end <= offset:
            end = offset + chunk_size
        offset = end
    return changed


def _export_files(sandbox_id: str, snapshot_id: str) -> dict:
    base_image_id = _base_image_id()
    source_root = config.vm_path(sandbox_id)
    base_root = config.vm_path(config.BASE_VM)
    source_disk_path = os.path.join(source_root, "disk.img")
    base_disk_path = os.path.join(base_root, "disk.img")
    disk_size = os.path.getsize(source_disk_path)
    if disk_size != os.path.getsize(base_disk_path):
        raise RuntimeError("sandbox and base disk sizes differ")

    # The scan is disk-bound; compression and upload of changed chunks run in
    # workers so the transfer hides inside the read time instead of after it.
    # In-flight chunks are bounded — the scan outpaces the uploads, and an
    # unbounded queue would hold gigabytes of buffers.
    chunks = []
    uploaded_bytes = 0
    in_flight: deque = deque()
    max_in_flight = TRANSFER_WORKERS * 4

    def finish_one() -> None:
        nonlocal uploaded_bytes
        index, length, future = in_flight.popleft()
        digest, stored_size = future.result()
        uploaded_bytes += stored_size
        chunks.append({"index": index, "length": length, "blob": digest})

    # Fastest path: APFS copy-on-write means a chunk still physically shared
    # with the base is byte-identical — change detection becomes a metadata
    # walk and only changed chunks get read at all.
    candidate_chunks: set | None = None
    try:
        candidate_chunks = _extent_changed_chunks(
            source_disk_path, base_disk_path, disk_size, config.SNAPSHOT_CHUNK_SIZE
        )
        print(f"Portable snapshot {snapshot_id}: extent scan found {len(candidate_chunks)} candidate chunks", flush=True)
    except (OSError, RuntimeError) as error:
        print(f"Portable snapshot {snapshot_id}: extent scan unavailable ({error}); falling back to read scan", flush=True)

    if candidate_chunks is not None:
        # Physical divergence outlives content divergence: a chunk a past
        # restore wrote stays "changed" by extents forever. When base hashes
        # exist, read only the candidates and keep the ones that truly differ.
        candidate_hashes = _load_base_hashes(base_image_id, config.SNAPSHOT_CHUNK_SIZE)
        with ThreadPoolExecutor(max_workers=TRANSFER_WORKERS) as pool:
            with open(source_disk_path, "rb", buffering=0) as source:
                for index in sorted(candidate_chunks):
                    offset = index * config.SNAPSHOT_CHUNK_SIZE
                    if offset >= disk_size:
                        continue
                    length = min(config.SNAPSHOT_CHUNK_SIZE, disk_size - offset)
                    source.seek(offset)
                    source_chunk = source.read(length)
                    if len(source_chunk) != length:
                        raise RuntimeError(f"short disk read at offset {offset}")
                    if candidate_hashes is not None and xxhash.xxh3_128_hexdigest(source_chunk) == candidate_hashes[index]:
                        continue
                    in_flight.append((index, length, pool.submit(_compressed_blob, source_chunk)))
                    if len(in_flight) >= max_in_flight:
                        finish_one()
            while in_flight:
                finish_one()
        return {
            "version": 2,
            "snapshot_id": snapshot_id,
            "base_image_id": base_image_id,
            "disk_size": disk_size,
            "chunk_size": config.SNAPSHOT_CHUNK_SIZE,
            "compression": "zstd",
            "disk_chunks": chunks,
            "stored_bytes": uploaded_bytes,
        }

    # Read-based fallback: cached base-chunk hashes make it a single pass over
    # the source; the cache builds itself during a first dual-read export.
    base_hashes = _load_base_hashes(base_image_id, config.SNAPSHOT_CHUNK_SIZE)
    building_hashes: list | None = None if base_hashes is not None else []

    with ThreadPoolExecutor(max_workers=TRANSFER_WORKERS) as pool:
        with open(source_disk_path, "rb", buffering=0) as source:
            base = None if base_hashes is not None else open(base_disk_path, "rb", buffering=0)
            try:
                for index, offset in enumerate(range(0, disk_size, config.SNAPSHOT_CHUNK_SIZE)):
                    length = min(config.SNAPSHOT_CHUNK_SIZE, disk_size - offset)
                    source_chunk = source.read(length)
                    if len(source_chunk) != length:
                        raise RuntimeError(f"short disk read at offset {offset}")
                    if base_hashes is not None:
                        unchanged = xxhash.xxh3_128_hexdigest(source_chunk) == base_hashes[index]
                    else:
                        base_chunk = base.read(length)
                        if len(base_chunk) != length:
                            raise RuntimeError(f"short base read at offset {offset}")
                        building_hashes.append(xxhash.xxh3_128_hexdigest(base_chunk))
                        unchanged = source_chunk == base_chunk
                    if unchanged:
                        continue
                    in_flight.append((index, length, pool.submit(_compressed_blob, source_chunk)))
                    if len(in_flight) >= max_in_flight:
                        finish_one()
                    if offset // (1024 * 1024 * 1024) != (offset + length) // (1024 * 1024 * 1024):
                        print(
                            f"Portable snapshot {snapshot_id}: scanned {offset + length}/{disk_size} bytes, "
                            f"{len(chunks) + len(in_flight)} changed chunks",
                            flush=True,
                        )
            finally:
                if base is not None:
                    base.close()
        while in_flight:
            finish_one()

    if building_hashes is not None and len(building_hashes) == (disk_size + config.SNAPSHOT_CHUNK_SIZE - 1) // config.SNAPSHOT_CHUNK_SIZE:
        _save_base_hashes(base_image_id, config.SNAPSHOT_CHUNK_SIZE, building_hashes)

    return {
        "version": 2,
        "snapshot_id": snapshot_id,
        "base_image_id": base_image_id,
        "disk_size": disk_size,
        "chunk_size": config.SNAPSHOT_CHUNK_SIZE,
        "compression": "zstd",
        "disk_chunks": chunks,
        "stored_bytes": uploaded_bytes,
    }


async def export(sandbox_id: str, snapshot_id: str) -> dict:
    t0 = time.monotonic()
    await lume.execute(sandbox_id, "/bin/sync")
    t1 = time.monotonic()
    await lume.stop(sandbox_id)
    # Never scan a disk the hypervisor may still be writing: a report of
    # "stopped" from the CLI is not proof the VM has released the file.
    for _ in range(30):
        vm = await lume.find(sandbox_id)
        if vm is None or vm["status"] != "running":
            break
        await asyncio.sleep(1)
    else:
        raise RuntimeError(f"{sandbox_id} still running after stop; refusing to scan its disk")
    t2 = time.monotonic()
    manifest = await asyncio.to_thread(_export_files, sandbox_id, snapshot_id)
    t3 = time.monotonic()
    print(
        f"[timing] export {sandbox_id}: sync={t1 - t0:.1f}s vm-stop={t2 - t1:.1f}s "
        f"disk-scan+upload={t3 - t2:.1f}s ({len(manifest['disk_chunks'])} chunks, "
        f"{manifest['stored_bytes'] / 1024**2:.0f} MiB) total={t3 - t0:.1f}s",
        flush=True,
    )
    return manifest


def _restore_files(sandbox_id: str, manifest: dict) -> None:
    if manifest.get("version") != 2:
        raise RuntimeError("unsupported portable snapshot version")
    if manifest.get("base_image_id") != _base_image_id():
        raise RuntimeError(
            f"snapshot requires base image {manifest.get('base_image_id')}, "
            f"but this node has {_base_image_id()}"
        )

    root = config.vm_path(sandbox_id)
    disk_path = os.path.join(root, "disk.img")
    if os.path.getsize(disk_path) != manifest.get("disk_size"):
        raise RuntimeError("destination base disk has the wrong size")
    chunk_size = manifest.get("chunk_size")
    if not isinstance(chunk_size, int) or chunk_size <= 0:
        raise RuntimeError("snapshot chunk size is invalid")
    chunks = manifest.get("disk_chunks")
    if not isinstance(chunks, list):
        raise RuntimeError("snapshot disk chunks are invalid")
    indexes = [chunk.get("index") for chunk in chunks if isinstance(chunk, dict)]
    if len(indexes) != len(chunks) or len(set(indexes)) != len(indexes):
        raise RuntimeError("snapshot disk chunk indexes are invalid")
    for chunk in chunks:
        index = chunk.get("index")
        length = chunk.get("length")
        if (
            not isinstance(index, int)
            or index < 0
            or not isinstance(length, int)
            or length <= 0
            or length > chunk_size
            or index * chunk_size + length > manifest["disk_size"]
        ):
            raise RuntimeError(f"snapshot chunk {index} is outside the disk")

    compression = manifest.get("compression", "gzip")

    def fetch(chunk: dict) -> tuple[int, int, bytes]:
        content = _decompress(_get_blob(chunk["blob"]), compression)
        return chunk["index"], chunk["length"], content

    # Fetch and decompress in workers; writes land as results arrive.
    with open(disk_path, "r+b", buffering=0) as disk:
        with ThreadPoolExecutor(max_workers=TRANSFER_WORKERS) as pool:
            for index, length, content in pool.map(fetch, chunks):
                if len(content) != length:
                    raise RuntimeError(f"snapshot chunk {index} has the wrong length")
                disk.seek(index * chunk_size)
                disk.write(content)
        disk.flush()
        os.fsync(disk.fileno())


async def restore(sandbox_id: str, manifest: dict) -> None:
    t0 = time.monotonic()
    await lume.clone(config.BASE_VM, sandbox_id)
    t1 = time.monotonic()
    try:
        await asyncio.to_thread(_restore_files, sandbox_id, manifest)
        t2 = time.monotonic()
        await lume.start(sandbox_id)
        t3 = time.monotonic()
        print(
            f"[timing] restore {sandbox_id}: clone={t1 - t0:.1f}s "
            f"apply-chunks={t2 - t1:.1f}s vm-start={t3 - t2:.1f}s total={t3 - t0:.1f}s",
            flush=True,
        )
    except BaseException:
        await lume.delete(sandbox_id)
        raise
