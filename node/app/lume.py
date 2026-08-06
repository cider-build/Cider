import asyncio
import json
import os
import shlex
import subprocess
import tempfile

from . import config
from .errors import NodeOperationError

SSH_OPTIONS = [
    "-i", config.SSH_KEY,
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
]


async def run(*args: str, check: bool = True, **kwargs) -> str:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **kwargs,
    )
    stdout, stderr = await proc.communicate()
    if check and proc.returncode != 0:
        raise NodeOperationError(stderr.decode().strip() or stdout.decode().strip())
    return stdout.decode()


async def lume(*args: str, check: bool = True) -> str:
    return await run(config.LUME, *args, "--storage", config.VM_STORAGE, check=check)


async def start(name: str) -> None:
    # Detach because lume run must own the VM after this request returns.
    # Use a file because an unread stderr pipe can block the process.
    log = tempfile.NamedTemporaryFile(prefix="cider-lume-run-", suffix=".log", delete=False)
    try:
        with log:
            process = subprocess.Popen(
                [config.LUME, "run", "--no-display", name, "--storage", config.VM_STORAGE],
                stdout=subprocess.DEVNULL,
                stderr=log,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
            )
    except OSError as error:
        os.unlink(log.name)
        raise NodeOperationError(f"could not launch lume run for {name}: {error}")

    try:
        deadline = asyncio.get_running_loop().time() + config.START_TIMEOUT_SECONDS
        while True:
            code = process.poll()
            if code is not None:
                with open(log.name) as file:
                    detail = file.read().strip()
                raise NodeOperationError(
                    f"lume run for {name} exited during startup ({code})" + (f": {detail}" if detail else "")
                )
            vm = await find(name)
            if vm is not None and vm["status"] == "running":
                return
            if asyncio.get_running_loop().time() >= deadline:
                raise NodeOperationError(f"VM {name} did not reach running within {config.START_TIMEOUT_SECONDS} seconds")
            await asyncio.sleep(1)
    except BaseException:
        # Stop the owner process unless the VM reached a verified running state.
        if process.poll() is None:
            process.kill()
            process.wait()
        raise
    finally:
        os.unlink(log.name)


async def list_vms() -> list[dict]:
    # lume get uses the same exit status for missing VMs and operational failures.
    return json.loads(await lume("ls", "-f", "json"))


async def find(name: str) -> dict | None:
    for vm in await list_vms():
        if vm["name"] == name:
            return vm
    return None


async def details(name: str) -> dict:
    found = await find(name)
    if found is None:
        raise NodeOperationError(f"VM not found: {name}")
    return found


async def ip(name: str) -> str:
    deadline = asyncio.get_running_loop().time() + config.START_TIMEOUT_SECONDS
    while True:
        address = (await details(name)).get("ipAddress")
        if address:
            return address
        if asyncio.get_running_loop().time() >= deadline:
            raise NodeOperationError(f"VM {name} did not report an IP within {config.START_TIMEOUT_SECONDS} seconds")
        await asyncio.sleep(2)


async def copy(action: str, source: str, destination: str) -> None:
    await run(
        config.LUME, action, source, destination,
        "--source-storage", config.VM_STORAGE,
        "--dest-storage", config.VM_STORAGE,
    )


async def clone(source: str, destination: str) -> None:
    await copy("clone", source, destination)


async def snapshot(source: str, destination: str) -> None:
    await copy("snapshot", source, destination)


async def create(sandbox_id: str | None = None) -> str:
    sandbox_id = sandbox_id or config.new_sandbox_id()
    if not sandbox_id.startswith(config.SANDBOX_PREFIX):
        raise NodeOperationError(f"sandbox id must start with {config.SANDBOX_PREFIX!r}")

    await clone(config.BASE_VM, sandbox_id)
    try:
        await start(sandbox_id)
    except NodeOperationError as error:
        try:
            await delete(sandbox_id)
        except NodeOperationError as cleanup_error:
            raise NodeOperationError(f"{error}; cleanup of {sandbox_id} also failed: {cleanup_error}")
        raise
    return sandbox_id


async def stop(name: str, check: bool = True) -> None:
    await lume("stop", name, check=check)


async def delete(name: str) -> None:
    if name == config.BASE_VM or not name.startswith(config.SANDBOX_PREFIX):
        raise NodeOperationError(f"refusing to delete unmanaged VM: {name}")

    await stop(name, check=False)
    await lume("delete", name, "--force")


async def upload(sandbox_id: str, archive_path: str) -> None:
    address = await ip(sandbox_id)
    if config.SSH_PASSWORD is None:
        await run("scp", *SSH_OPTIONS, archive_path, f"{config.SSH_USER}@{address}:/tmp/cider-source.tgz")
    else:
        with tempfile.TemporaryDirectory(prefix="cider-askpass-") as directory:
            askpass = os.path.join(directory, "askpass.sh")
            with open(askpass, "w") as file:
                file.write("#!/bin/sh\nprintf '%s' \"$CIDER_SSH_PASSWORD\"\n")
            os.chmod(askpass, 0o700)
            environment = {
                **os.environ,
                "CIDER_SSH_PASSWORD": config.SSH_PASSWORD,
                "SSH_ASKPASS": askpass,
                "SSH_ASKPASS_REQUIRE": "force",
                "DISPLAY": "cider",
            }
            await run(
                "scp",
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                "-o", "LogLevel=ERROR",
                "-o", "PreferredAuthentications=password",
                "-o", "PubkeyAuthentication=no",
                archive_path,
                f"{config.SSH_USER}@{address}:/tmp/cider-source.tgz",
                stdin=asyncio.subprocess.DEVNULL,
                env=environment,
            )
    guest_dir = shlex.quote(config.GUEST_DIR)
    await execute(
        sandbox_id,
        f"mkdir -p {guest_dir} && find {guest_dir} -mindepth 1 -maxdepth 1 -exec rm -rf {{}} + && tar -xzf /tmp/cider-source.tgz -C {guest_dir} && rm /tmp/cider-source.tgz",
    )


async def execute(sandbox_id: str, command: str) -> str:
    if config.SSH_PASSWORD is not None:
        return await lume(
            "ssh",
            sandbox_id,
            command,
            "--user", config.SSH_USER,
            "--password", config.SSH_PASSWORD,
            "--timeout", "0",
        )
    address = await ip(sandbox_id)
    return await run("ssh", *SSH_OPTIONS, f"{config.SSH_USER}@{address}", command)
