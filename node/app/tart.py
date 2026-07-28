import asyncio
import shlex
import subprocess

from . import config

SSH_OPTIONS = [
    "-i", config.SSH_KEY,
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
]


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


async def run_to_file(path: str, *args: str) -> None:
    with open(path, "wb") as file:
        proc = await asyncio.create_subprocess_exec(*args, stdout=file, stderr=asyncio.subprocess.PIPE)
        _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip())


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
    await run("scp", *SSH_OPTIONS, archive_path, f"{config.SSH_USER}@{ip}:/tmp/cider-source.tgz")
    guest_dir = shlex.quote(config.GUEST_DIR)
    await run(
        "ssh", *SSH_OPTIONS, f"{config.SSH_USER}@{ip}",
        f"mkdir -p {guest_dir} && find {guest_dir} -mindepth 1 -maxdepth 1 -exec rm -rf {{}} + && tar -xzf /tmp/cider-source.tgz -C {guest_dir} && rm /tmp/cider-source.tgz",
    )


async def export(sandbox_id: str, archive_path: str) -> None:
    ip = (await tart("ip", sandbox_id, "--wait", str(config.START_TIMEOUT_SECONDS))).strip()
    await run("ssh", *SSH_OPTIONS, f"{config.SSH_USER}@{ip}", f"mkdir -p {shlex.quote(config.GUEST_DIR)}")
    await run_to_file(archive_path, "ssh", *SSH_OPTIONS, f"{config.SSH_USER}@{ip}", f"tar -czf - -C {shlex.quote(config.GUEST_DIR)} .")


async def import_vm(archive_path: str, sandbox_id: str | None = None) -> str:
    sandbox_id = await create(sandbox_id)
    await upload(sandbox_id, archive_path)
    return sandbox_id


async def delete(sandbox_id: str) -> None:
    if sandbox_id == config.BASE_VM or not sandbox_id.startswith(config.SANDBOX_PREFIX):
        raise RuntimeError(f"refusing to delete unmanaged VM: {sandbox_id}")

    await tart("stop", sandbox_id, "--timeout", str(config.STOP_TIMEOUT_SECONDS), check=False)
    await tart("delete", sandbox_id)


async def execute(sandbox_id: str, command: str) -> str:
    ip = (await tart("ip", sandbox_id, "--wait", str(config.START_TIMEOUT_SECONDS))).strip()
    return await run("ssh", *SSH_OPTIONS, f"{config.SSH_USER}@{ip}", command)
