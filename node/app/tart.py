import asyncio
import subprocess

from . import config


async def run_tart(*args: str, check: bool = True) -> str:
    proc = await asyncio.create_subprocess_exec(
        config.TART,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if check and proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip() or stdout.decode().strip())
    return stdout.decode()


def start(sandbox_id: str) -> None:
    subprocess.Popen(
        [config.TART, "run", "--no-graphics", sandbox_id],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )


async def create(sandbox_id: str | None = None) -> str:
    sandbox_id = sandbox_id or config.new_sandbox_id()
    if not sandbox_id.startswith(config.SANDBOX_PREFIX):
        raise RuntimeError(f"sandbox id must start with {config.SANDBOX_PREFIX!r}")

    await run_tart("clone", config.BASE_VM, sandbox_id)
    await run_tart("set", sandbox_id, "--random-mac")
    start(sandbox_id)
    return sandbox_id


async def delete(sandbox_id: str) -> None:
    if sandbox_id == config.BASE_VM or not sandbox_id.startswith(config.SANDBOX_PREFIX):
        raise RuntimeError(f"refusing to delete unmanaged VM: {sandbox_id}")

    await run_tart("stop", sandbox_id, "--timeout", str(config.STOP_TIMEOUT_SECONDS), check=False)
    await run_tart("delete", sandbox_id)
