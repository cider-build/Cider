import asyncio
import shlex
import subprocess

from . import config


async def run(*args: str, check: bool = True) -> str:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if check and proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip() or stdout.decode().strip())
    return stdout.decode()


async def tart(*args: str, check: bool = True) -> str:
    return await run(config.TART, *args, check=check)


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

    await tart("clone", config.BASE_VM, sandbox_id)
    await tart("set", sandbox_id, "--random-mac")
    start(sandbox_id)
    return sandbox_id


async def upload(sandbox_id: str, archive_path: str) -> None:
    ip = (await tart("ip", sandbox_id, "--wait", str(config.START_TIMEOUT_SECONDS))).strip()
    ssh = [
        "-i", config.SSH_KEY,
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
    ]
    await run("scp", *ssh, archive_path, f"{config.SSH_USER}@{ip}:/tmp/cider-source.tgz")
    guest_dir = shlex.quote(config.GUEST_DIR)
    await run(
        "ssh", *ssh, f"{config.SSH_USER}@{ip}",
        f"rm -rf {guest_dir} && mkdir -p {guest_dir} && tar -xzf /tmp/cider-source.tgz -C {guest_dir} && rm /tmp/cider-source.tgz",
    )


async def delete(sandbox_id: str) -> None:
    if sandbox_id == config.BASE_VM or not sandbox_id.startswith(config.SANDBOX_PREFIX):
        raise RuntimeError(f"refusing to delete unmanaged VM: {sandbox_id}")

    await tart("stop", sandbox_id, "--timeout", str(config.STOP_TIMEOUT_SECONDS), check=False)
    await tart("delete", sandbox_id)
