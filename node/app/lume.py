import asyncio
import base64
import json
import os
import plistlib
import secrets
import shlex
import shutil
import subprocess
import tempfile
import uuid

from . import config
from .errors import NodeOperationError

SSH_OPTIONS = [
    "-i", config.SSH_KEY,
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    "-o", f"ConnectTimeout={config.SSH_CONNECT_TIMEOUT_SECONDS}",
    "-o", "ConnectionAttempts=1",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
]

_delete_tasks: set[asyncio.Task] = set()
MIN_MEMORY_BYTES = 1024**3


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
            await asyncio.sleep(config.VM_POLL_SECONDS)
    except BaseException:
        # Stop the owner process unless the VM reached a verified running state.
        if process.poll() is None:
            process.kill()
            process.wait()
        raise
    finally:
        os.unlink(log.name)


async def list_vms() -> list[dict]:
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
        await asyncio.sleep(config.VM_POLL_SECONDS)


async def clone(
    source: str,
    destination: str,
    cpu_count: int | None = None,
    memory_bytes: int | None = None,
) -> None:
    source_path = config.vm_path(source)
    destination_path = config.vm_path(destination)
    if not os.path.isdir(source_path):
        raise NodeOperationError(f"VM directory not found: {source_path}")
    source_vm = await find(source)
    if source_vm is not None and source_vm["status"] == "running":
        raise NodeOperationError(f"cannot clone a running VM: {source}")
    if os.path.exists(destination_path):
        raise NodeOperationError(f"clone destination already exists: {destination_path}")

    config_path = os.path.join(source_path, "config.json")
    required_files = (config_path, os.path.join(source_path, "disk.img"), os.path.join(source_path, "nvram.bin"))
    if not all(os.path.isfile(path) for path in required_files):
        raise NodeOperationError(f"VM clone source is incomplete: {source}")
    try:
        with open(config_path) as file:
            vm_config = json.load(file)
    except json.JSONDecodeError as error:
        raise NodeOperationError(f"VM config is invalid: {source}") from error
    if not isinstance(vm_config.get("machineIdentifier"), str) or not isinstance(vm_config.get("macAddress"), str):
        raise NodeOperationError(f"VM config has no clone identity: {source}")
    if cpu_count is not None:
        if cpu_count < 1:
            raise NodeOperationError("VM CPU count must be at least one")
        vm_config["cpuCount"] = cpu_count
    if memory_bytes is not None:
        if memory_bytes < MIN_MEMORY_BYTES:
            raise NodeOperationError("VM memory size must be at least 1 GiB")
        if memory_bytes % 1024**2 != 0:
            raise NodeOperationError("VM memory size must be a multiple of 1 MiB")
        vm_config["memorySize"] = memory_bytes

    machine_identifier = plistlib.dumps(
        {"ECID": secrets.randbits(63) or 1},
        fmt=plistlib.FMT_BINARY,
        sort_keys=False,
    )
    mac = bytearray(secrets.token_bytes(6))
    mac[0] = (mac[0] & 0xFC) | 0x02
    vm_config["machineIdentifier"] = base64.b64encode(machine_identifier).decode()
    vm_config["macAddress"] = ":".join(f"{byte:02x}" for byte in mac)

    staging_path = os.path.join(config.VM_STORAGE, f".{destination}.clone-{uuid.uuid4().hex}")
    os.mkdir(staging_path)
    try:
        with open(os.path.join(staging_path, "config.json"), "w") as file:
            json.dump(vm_config, file, separators=(",", ":"))
        for filename in ("disk.img", "nvram.bin"):
            await run(
                "/bin/cp",
                "-c",
                os.path.join(source_path, filename),
                os.path.join(staging_path, filename),
            )
        os.rename(staging_path, destination_path)
    except BaseException:
        await asyncio.to_thread(shutil.rmtree, staging_path, True)
        raise


async def snapshot(source: str, destination: str) -> None:
    source_path = config.vm_path(source)
    destination_path = config.vm_path(destination)
    if not os.path.isdir(source_path):
        raise NodeOperationError(f"VM directory not found: {source_path}")
    if os.path.exists(destination_path):
        raise NodeOperationError(f"snapshot destination already exists: {destination_path}")
    required_files = ("config.json", "disk.img", "nvram.bin")
    for filename in required_files:
        if not os.path.isfile(os.path.join(source_path, filename)):
            raise NodeOperationError(f"VM snapshot source is missing {filename}: {source}")

    staging_path = os.path.join(config.VM_STORAGE, f".{destination}.snapshot-{uuid.uuid4().hex}")
    os.mkdir(staging_path)
    try:
        await asyncio.to_thread(
            shutil.copy2,
            os.path.join(source_path, "config.json"),
            os.path.join(staging_path, "config.json"),
        )
        for filename in ("disk.img", "nvram.bin"):
            await run(
                "/bin/cp",
                "-c",
                os.path.join(source_path, filename),
                os.path.join(staging_path, filename),
            )
        os.rename(staging_path, destination_path)
    except BaseException:
        await asyncio.to_thread(shutil.rmtree, staging_path, True)
        raise


async def create(
    sandbox_id: str | None = None,
    cpu_count: int | None = None,
    memory_bytes: int | None = None,
) -> str:
    sandbox_id = sandbox_id or config.new_sandbox_id()
    if not sandbox_id.startswith(config.SANDBOX_PREFIX):
        raise NodeOperationError(f"sandbox id must start with {config.SANDBOX_PREFIX!r}")

    await clone(config.BASE_VM, sandbox_id, cpu_count, memory_bytes)
    try:
        await start(sandbox_id)
        await wait_until_ready(sandbox_id)
    except NodeOperationError as error:
        try:
            await delete(sandbox_id)
        except NodeOperationError as cleanup_error:
            raise NodeOperationError(f"{error}; cleanup of {sandbox_id} also failed: {cleanup_error}")
        raise
    return sandbox_id


async def configure(name: str, cpu_count: int, memory_bytes: int) -> None:
    if cpu_count < 1:
        raise NodeOperationError("VM CPU count must be at least one")
    if memory_bytes < MIN_MEMORY_BYTES:
        raise NodeOperationError("VM memory size must be at least 1 GiB")
    if memory_bytes % 1024**2 != 0:
        raise NodeOperationError("VM memory size must be a multiple of 1 MiB")
    vm = await find(name)
    if vm is None:
        raise NodeOperationError(f"VM not found: {name}")
    if vm["status"] != "stopped":
        raise NodeOperationError(f"cannot configure a running VM: {name}")
    config_path = os.path.join(config.vm_path(name), "config.json")
    try:
        with open(config_path) as file:
            vm_config = json.load(file)
    except json.JSONDecodeError as error:
        raise NodeOperationError(f"VM config is invalid: {name}") from error
    vm_config["cpuCount"] = cpu_count
    vm_config["memorySize"] = memory_bytes
    staging_path = f"{config_path}.{uuid.uuid4().hex}.tmp"
    try:
        with open(staging_path, "w") as file:
            json.dump(vm_config, file, separators=(",", ":"))
        os.replace(staging_path, config_path)
    finally:
        try:
            os.unlink(staging_path)
        except FileNotFoundError:
            pass


async def wait_until_ready(name: str) -> None:
    deadline = asyncio.get_running_loop().time() + config.START_TIMEOUT_SECONDS
    last_error: NodeOperationError | None = None
    while True:
        address = (await details(name)).get("ipAddress")
        if address is not None:
            try:
                if config.SSH_PASSWORD is None:
                    await run("ssh", *SSH_OPTIONS, f"{config.SSH_USER}@{address}", "true")
                else:
                    await lume(
                        "ssh",
                        name,
                        "true",
                        "--user", config.SSH_USER,
                        "--password", config.SSH_PASSWORD,
                        "--timeout", str(config.SSH_CONNECT_TIMEOUT_SECONDS),
                    )
                return
            except NodeOperationError as error:
                last_error = error
        if asyncio.get_running_loop().time() >= deadline:
            detail = f": {last_error}" if last_error is not None else ""
            raise NodeOperationError(
                f"VM {name} did not become SSH-ready within {config.START_TIMEOUT_SECONDS} seconds{detail}"
            )
        await asyncio.sleep(config.VM_POLL_SECONDS)


async def stop(name: str, check: bool = True) -> None:
    await lume("stop", name, check=check)


async def _remove_trashed_vm(path: str) -> None:
    await asyncio.to_thread(shutil.rmtree, path)


def _track_delete(task: asyncio.Task) -> None:
    _delete_tasks.add(task)

    def finished(done: asyncio.Task) -> None:
        _delete_tasks.discard(done)
        error = done.exception()
        if error is not None:
            print(f"VM trash removal failed: {error}", flush=True)

    task.add_done_callback(finished)


async def drain_deletes() -> None:
    if _delete_tasks:
        await asyncio.gather(*tuple(_delete_tasks))


async def delete(name: str) -> None:
    if name == config.BASE_VM or not name.startswith(config.SANDBOX_PREFIX):
        raise NodeOperationError(f"refusing to delete unmanaged VM: {name}")

    vm = await find(name)
    if vm is None:
        raise NodeOperationError(f"VM not found: {name}")
    if vm["status"] == "running":
        await stop(name)
    source = config.vm_path(name)
    os.makedirs(config.VM_TRASH, exist_ok=True)
    if os.stat(config.VM_STORAGE).st_dev != os.stat(config.VM_TRASH).st_dev:
        raise NodeOperationError("CIDER_VM_TRASH must be on the same file system as CIDER_VM_STORAGE")
    destination = os.path.join(config.VM_TRASH, f"{name}-{uuid.uuid4().hex}")
    os.rename(source, destination)
    guard = os.path.join(config.VM_STORAGE, f".{name}.resize.guard")
    if os.path.exists(guard):
        os.unlink(guard)
    _track_delete(asyncio.create_task(_remove_trashed_vm(destination)))


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
