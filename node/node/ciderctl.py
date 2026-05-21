"""Typed async wrapper around the ciderctl binary.

ciderctl emits JSON on stdout for structured subcommands (list, exec). This module
parses that JSON into Pydantic models so callers never see raw dicts.
"""
import asyncio
import subprocess

from pydantic import BaseModel, ValidationError

from . import config


class CtlError(Exception):
    def __init__(self, returncode: int, stderr: str) -> None:
        super().__init__(stderr.strip() or f"ciderctl exited {returncode}")
        self.returncode = returncode
        self.stderr = stderr


class ExecResult(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


class SandboxEntry(BaseModel):
    id: str
    running: bool
    path: str


class _SandboxList(BaseModel):
    items: list[SandboxEntry]


async def _run(*args: str, timeout: float | None = None) -> str:
    proc = await asyncio.create_subprocess_exec(
        config.CIDERCTL,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise CtlError(-1, f"ciderctl {' '.join(args)} timed out after {timeout}s")
    if proc.returncode != 0:
        raise CtlError(proc.returncode or -1, stderr.decode() or stdout.decode())
    return stdout.decode()


async def list_sandboxes() -> list[SandboxEntry]:
    output = await _run("list")
    try:
        # ciderctl emits a JSON array; wrap so we can use Pydantic's parser.
        return _SandboxList.model_validate_json(f'{{"items": {output}}}').items
    except ValidationError as e:
        raise CtlError(-1, f"unexpected `ciderctl list` output: {e}")


async def clone(sandbox_id: str) -> None:
    await _run("clone", config.BASE_BUNDLE, sandbox_id)


def spawn_run(sandbox_id: str) -> None:
    """Detached background process; ciderctl owns the VM lifecycle and writes vm.pid."""
    subprocess.Popen(
        [config.CIDERCTL, "run", sandbox_id],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )


async def exec_command(sandbox_id: str, command: str) -> ExecResult:
    output = await _run("exec", sandbox_id, command, timeout=config.EXEC_TIMEOUT_SECONDS)
    try:
        return ExecResult.model_validate_json(output)
    except ValidationError as e:
        raise CtlError(-1, f"unexpected `ciderctl exec` output: {e}")


async def delete(sandbox_id: str) -> None:
    await _run("delete", sandbox_id)
