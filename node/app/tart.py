"""Typed async wrapper around the Tart CLI."""
import asyncio
import json
import logging
import subprocess
import time
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

from . import config

log = logging.getLogger(__name__)

_RUN_LOG_DIR = Path.home() / ".cider" / "logs"


class TartError(Exception):
    def __init__(self, returncode: int, stderr: str) -> None:
        super().__init__(stderr.strip() or f"tart exited {returncode}")
        self.returncode = returncode
        self.stderr = stderr


class ExecResult(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


class SandboxEntry(BaseModel):
    id: str
    running: bool


class _TartListEntry(BaseModel):
    name: str = Field(alias="Name")
    running: bool = Field(alias="Running")
    source: str = Field(alias="Source")


def _summary(args: tuple[str, ...]) -> str:
    if args and args[0] == "exec" and len(args) >= 3:
        return f"exec {args[1]} {args[2][:60]!r}"
    return " ".join(args)


async def _run(*args: str, timeout: float | None = None) -> str:
    result = await _run_process(*args, timeout=timeout)
    if result.exit_code != 0:
        raise TartError(result.exit_code, result.stderr or result.stdout)
    return result.stdout


async def _run_process(*args: str, timeout: float | None = None) -> ExecResult:
    label = _summary(args)
    log.info("tart %s start", label)
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        config.TART,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        elapsed = time.monotonic() - started
        log.warning("tart %s TIMEOUT after %.1fs", label, elapsed)
        raise TartError(-1, f"tart {' '.join(args)} timed out after {timeout}s")

    result = ExecResult(
        stdout=stdout.decode(),
        stderr=stderr.decode(),
        exit_code=proc.returncode or 0,
    )
    elapsed = time.monotonic() - started
    if result.exit_code != 0:
        log.warning(
            "tart %s exited %d in %.2fs: %s",
            label,
            result.exit_code,
            elapsed,
            (result.stderr or result.stdout).strip()[:200],
        )
    else:
        log.info("tart %s done in %.2fs", label, elapsed)
    return result


async def list_sandboxes() -> list[SandboxEntry]:
    return [
        entry
        for entry in await _list_local_vms()
        if entry.id.startswith(config.SANDBOX_PREFIX)
    ]


async def _list_local_vms() -> list[SandboxEntry]:
    output = await _run("list", "--source", "local", "--format", "json")
    try:
        entries = [_TartListEntry.model_validate(item) for item in json.loads(output)]
    except (json.JSONDecodeError, ValidationError) as e:
        raise TartError(-1, f"unexpected `tart list --format json` output: {e}")
    return [
        SandboxEntry(id=entry.name, running=entry.running)
        for entry in entries
        if entry.source == "local"
    ]


async def exists(sandbox_id: str) -> bool:
    return any(s.id == sandbox_id for s in await _list_local_vms())


async def base_ready() -> bool:
    return await exists(config.BASE_VM)


async def clone(sandbox_id: str) -> None:
    await _run("clone", config.BASE_VM, sandbox_id)
    await _run("set", sandbox_id, "--random-mac")


def _dir_share_arg(mount_path: str) -> str:
    if ":" in mount_path:
        raise TartError(-1, "mounted paths cannot contain ':'")
    return f"cider:{mount_path}"


def spawn_run(sandbox_id: str, mount_path: str | None = None) -> None:
    _RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = _RUN_LOG_DIR / f"{sandbox_id}.log"
    log_fh = open(log_path, "ab")
    cmd = [config.TART, "run", "--no-graphics"]
    if mount_path is not None:
        cmd.extend(["--dir", _dir_share_arg(mount_path)])
    cmd.append(sandbox_id)
    proc = subprocess.Popen(
        cmd,
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    log_fh.close()
    log.info("tart run %s spawned (pid %d, log %s)", sandbox_id, proc.pid, log_path)


async def ip(sandbox_id: str) -> str:
    output = await _run("ip", sandbox_id, "--wait", str(config.START_TIMEOUT_SECONDS))
    address = output.strip()
    if not address:
        raise TartError(-1, "tart ip returned empty output")
    return address


async def exec_command(sandbox_id: str, command: str) -> ExecResult:
    address = await ip(sandbox_id)
    return await _run_ssh(
        address,
        command,
        timeout=config.EXEC_TIMEOUT_SECONDS,
    )


async def _run_ssh(address: str, command: str, timeout: float | None = None) -> ExecResult:
    label = f"ssh {config.SSH_USER}@{address} {command[:60]!r}"
    log.info("%s start", label)
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        "/usr/bin/ssh",
        "-i",
        config.SSH_KEY,
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        "-o",
        f"ConnectTimeout={config.SSH_CONNECT_TIMEOUT_SECONDS}",
        f"{config.SSH_USER}@{address}",
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        elapsed = time.monotonic() - started
        log.warning("%s TIMEOUT after %.1fs", label, elapsed)
        raise TartError(-1, f"ssh {config.SSH_USER}@{address} timed out after {timeout}s")

    result = ExecResult(
        stdout=stdout.decode(),
        stderr=stderr.decode(),
        exit_code=proc.returncode or 0,
    )
    elapsed = time.monotonic() - started
    if result.exit_code != 0:
        log.warning(
            "%s exited %d in %.2fs: %s",
            label,
            result.exit_code,
            elapsed,
            (result.stderr or result.stdout).strip()[:200],
        )
    else:
        log.info("%s done in %.2fs", label, elapsed)
    return result


async def delete(sandbox_id: str) -> None:
    if sandbox_id == config.BASE_VM:
        raise TartError(-1, f"refusing to delete base Tart VM: {sandbox_id}")
    if not sandbox_id.startswith(config.SANDBOX_PREFIX):
        raise TartError(-1, f"refusing to delete unmanaged Tart VM: {sandbox_id}")
    sandboxes = await list_sandboxes()
    match = next((s for s in sandboxes if s.id == sandbox_id), None)
    if match is None:
        raise TartError(-1, f"tart VM not found: {sandbox_id}")
    if match.running:
        await _run("stop", sandbox_id, "--timeout", str(config.STOP_TIMEOUT_SECONDS))
    await _run("delete", sandbox_id)
