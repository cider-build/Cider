import asyncio
import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlmodel import select
from typing import Annotated

from ..auth import AuthContext, current_auth_context
from ..db import get_session
from ..models import Node, Server
from ..services import node_transport, vm_lifecycle, warm_pool
from ..snapshot_store import discard_manifest, manifest_path

router = APIRouter(prefix="/servers")

ServerName = Annotated[str, StringConstraints(min_length=1, max_length=63, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$")]


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


class ServerConfig(BaseModel):
    """A server's spec — the same shape a project's cider.yaml grows into.

    `image` names a base image; only the default exists today. Software
    installs run during provisioning. Secrets (the Telegram token) are
    injected at boot and must never end up in any shared image.
    """

    image: str = "macos-26"
    software: list[str] = []
    channels: list[str] = []
    env: dict[str, str] = {}
    setup: str | list[str] | None = None
    start: str | None = None


# Until the macos-dev base image ships with these baked in, installs run at
# provision time. Keep node/images/PREINSTALLED.md in sync with this list.
ENSURE_BREW = (
    'command -v brew >/dev/null || NONINTERACTIVE=1 /bin/bash -c '
    '"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
)
BREW_ON_PATH = (
    "grep -q 'brew shellenv' ~/.zprofile 2>/dev/null || "
    "echo 'eval \"$(/opt/homebrew/bin/brew shellenv)\"' >> ~/.zprofile"
)
SOFTWARE_INSTALLS: dict[str, list[str]] = {
    "claude-code": ["brew install node", "npm install -g @anthropic-ai/claude-code"],
    "codex": ["brew install node", "npm install -g @openai/codex"],
    "cursor": ["brew install --cask cursor"],
    "openclaw": [
        "brew install node",
        "export PATH=/opt/homebrew/bin:$PATH; curl -fsSL https://openclaw.ai/install.sh | bash",
    ],
}
# Xcode ships as its own base image (it does not fit the default image's
# disk); it is not installable at provision time.
UNPROVISIONABLE = {"xcode"}

LAUNCH_GATEWAY = "nohup openclaw gateway >/tmp/openclaw.log 2>&1 &"

# OpenClaw channel adapters Cider can configure. Every credential is a
# SecretRef into the VM's env, which the config's env map populates.
# WebChat ships with the core install and needs no credentials; iMessage
# and WhatsApp need interactive sign-in, so provisioning skips them.
CHANNEL_CONFIGS: dict[str, dict] = {
    "telegram": {
        "enabled": True,
        "botToken": {"source": "env", "provider": "default", "id": "TELEGRAM_BOT_TOKEN"},
    },
    "discord": {
        "enabled": True,
        "token": {"source": "env", "provider": "default", "id": "DISCORD_BOT_TOKEN"},
    },
    "slack": {
        "enabled": True,
        "mode": "socket",
        "appToken": {"source": "env", "provider": "default", "id": "SLACK_APP_TOKEN"},
        "botToken": {"source": "env", "provider": "default", "id": "SLACK_BOT_TOKEN"},
    },
}


def provision_commands(config: ServerConfig) -> tuple[list[str], str | None]:
    """Expand a config into ordered shell commands plus the start process."""
    software: list[str] = list(config.software)
    configured_channels = {name: CHANNEL_CONFIGS[name] for name in config.channels if name in CHANNEL_CONFIGS}
    if config.channels and "openclaw" not in software:
        software.append("openclaw")

    commands: list[str] = []
    if software:
        commands += [ENSURE_BREW, BREW_ON_PATH]
    for name in software:
        for command in SOFTWARE_INSTALLS[name]:
            if command not in commands:
                commands.append(command)
    # The env map is the general answer to "this software needs a key/setting":
    # values land in the login shell and, for OpenClaw, in its own .env file.
    for key, value in config.env.items():
        commands.append(f"echo export {key}={shell_quote(value)} >> ~/.zprofile")
    if "openclaw" in software and config.env:
        env_file = "".join(f"{key}={value}\n" for key, value in config.env.items())
        commands.append("mkdir -p ~/.openclaw && printf %s " + shell_quote(env_file) + " > ~/.openclaw/.env")
    if config.env:
        # Shell tools (claude, codex) read these from login shells.
        exports = "# cider env\n" + "".join(
            f"export {key}={shell_quote(value)}\n" for key, value in config.env.items()
        )
        commands.append(
            "grep -q '# cider env' ~/.zprofile 2>/dev/null || printf %s " + shell_quote(exports) + " >> ~/.zprofile"
        )
    if configured_channels:
        # Discord and Slack ship as external plugins; configuring the channel
        # also trusts its plugin, or the gateway refuses to start it.
        plugin_channels = {name for name in configured_channels if name in ("discord", "slack")}
        openclaw_config = json.dumps({
            "gateway": {"mode": "local"},
            "channels": configured_channels,
            **({"plugins": {"entries": {name: {"enabled": True} for name in plugin_channels}}} if plugin_channels else {}),
        })
        commands.append(
            "mkdir -p ~/.openclaw && printf %s " + shell_quote(openclaw_config) + " > ~/.openclaw/openclaw.json"
        )
        commands.append(LAUNCH_GATEWAY)

    if isinstance(config.setup, str):
        commands.append(config.setup)
    elif config.setup:
        commands += config.setup
    return commands, config.start


def relaunch_commands(config: ServerConfig) -> tuple[list[str], str | None]:
    """Commands to revive processes after a restore — installs are on the disk."""
    commands: list[str] = []
    if any(name in CHANNEL_CONFIGS for name in config.channels):
        commands.append(LAUNCH_GATEWAY)
    return commands, config.start


def storage_key(server: Server) -> str:
    return f"server-{server.id}"


class CreateServerInput(BaseModel):
    name: ServerName
    node_id: str | None = None
    config: ServerConfig | None = None


class ServerWithNode(BaseModel):
    id: str
    name: str
    node_id: str
    node_name: str
    status: str
    status_detail: str | None
    config: dict | None
    created_at: datetime
    deleted_at: datetime | None


def with_node(server: Server, node: Node) -> ServerWithNode:
    return ServerWithNode(**server.model_dump(exclude={"image"}), config=server.image, node_name=node.name)


def server_config(server: Server) -> ServerConfig:
    return ServerConfig.model_validate(server.image or {})


def owned_server(db, server_id: str, org_id: str) -> tuple[Server, Node]:
    server = db.get(Server, server_id)
    if server is None or server.deleted_at is not None or server.org_id != org_id:
        raise HTTPException(404, "server not found")
    node = db.get(Node, server.node_id)
    if node is None:
        raise HTTPException(404, "node not found")
    return server, node


@router.get("")
async def list_servers(
    include_deleted: bool = False,
    ctx: AuthContext = Depends(current_auth_context),
) -> list[ServerWithNode]:
    with get_session() as db:
        query = (
            select(Server, Node)
            .join(Node, Server.node_id == Node.id)
            .where(Server.org_id == ctx.membership.organization_id)
        )
        if not include_deleted:
            query = query.where(Server.deleted_at.is_(None))
        rows = db.exec(query.order_by(Server.created_at.desc())).all()
    return [with_node(server, node) for server, node in rows]


@router.post("", status_code=201)
async def create_server(body: CreateServerInput, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    org_id = ctx.membership.organization_id
    config = body.config or ServerConfig()
    unknown = [name for name in config.software if name not in SOFTWARE_INSTALLS]
    if any(name in UNPROVISIONABLE for name in unknown):
        raise HTTPException(422, "Xcode ships as its own base image and is not available yet")
    if unknown:
        raise HTTPException(422, f"unknown software: {', '.join(unknown)}")

    with get_session() as db:
        duplicate = db.exec(
            select(Server).where(
                Server.org_id == org_id,
                Server.name == body.name,
                Server.deleted_at.is_(None),
            )
        ).first()
        if duplicate is not None:
            raise HTTPException(409, f"a server named {body.name!r} already exists")

    # Claiming a warm sandbox gives an already-booted VM; the warm pool refills behind it.
    node, vm_id = warm_pool.claim_vm_for_server(org_id, body.node_id)
    commands, start = provision_commands(config)
    needs_provision = bool(commands or start)

    with get_session() as db:
        server = Server(
            org_id=org_id,
            node_id=node.id,
            name=body.name,
            vm_id=vm_id or "",
            image=config.model_dump(),
            status="provisioning" if (vm_id is None or needs_provision) else "running",
        )
        db.add(server)
        db.commit()
        db.refresh(server)
    if server.status == "provisioning":
        asyncio.create_task(provision_server(server.id, node.id))
    asyncio.create_task(warm_pool.ensure_node_has_warm_sandboxes(node.id))
    return with_node(server, node)


async def provision_server(server_id: str, node_id: str) -> None:
    """Get the VM (cold-boot if needed), apply the config, mark running."""
    with get_session() as db:
        node = db.get(Node, node_id)
        server = db.get(Server, server_id)
    if node is None or server is None:
        return
    vm_id = server.vm_id
    reserved = not vm_id
    try:
        if not vm_id:
            try:
                response = await node_transport.request(node, "POST", "/sandboxes")
            finally:
                # Release the slot reservation claim_vm_for_server took.
                warm_pool.warming[node_id] = max(0, warm_pool.warming[node_id] - 1)
                reserved = False
            vm_id = response.json()["id"]
            with get_session() as db:
                stored = db.get(Server, server_id)
                if stored is None or stored.deleted_at is not None:
                    await _discard_vm(node, vm_id)
                    return
                stored.vm_id = vm_id
                db.add(stored)
                db.commit()
        commands, start = provision_commands(server_config(server))
        await vm_lifecycle.run_launch(node, vm_id, setup=commands, start=start)
    except Exception as error:
        if reserved:
            warm_pool.warming[node_id] = max(0, warm_pool.warming[node_id] - 1)
        detail = error.detail if isinstance(error, HTTPException) else str(error)
        with get_session() as db:
            stored = db.get(Server, server_id)
            if stored is not None and stored.deleted_at is None:
                stored.status = "failed"
                stored.status_detail = str(detail)[:2000]
                db.add(stored)
                db.commit()
        return
    with get_session() as db:
        stored = db.get(Server, server_id)
        if stored is None or stored.deleted_at is not None:
            await _discard_vm(node, vm_id)
            return
        stored.status = "running"
        stored.status_detail = None
        db.add(stored)
        db.commit()


async def _discard_vm(node: Node, vm_id: str) -> None:
    try:
        await node_transport.request(node, "DELETE", f"/sandboxes/{vm_id}")
    except HTTPException:
        pass


@router.get("/{server_id}")
async def get_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
    return with_node(server, node)


@router.post("/{server_id}/stop")
async def stop_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    """Export the server's disk to Cider storage and free the node's slot.

    A stopped server lives in storage, tied to no node — start restores it
    onto any connected Mac with a free slot.
    """
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        if server.status == "stopped":
            return with_node(server, node)
        if server.status != "running":
            raise HTTPException(409, f"server is {server.status}; it cannot be stopped")
        # The export stops the VM long before the row updates; "stopping" keeps
        # the reconciler from reading that window as a dead server.
        server.status = "stopping"
        db.add(server)
        db.commit()
    asyncio.create_task(_stop_task(server_id, node.id))
    return with_node(server, node)


async def _stop_task(server_id: str, node_id: str) -> None:
    t0 = time.monotonic()
    with get_session() as db:
        node = db.get(Node, node_id)
        server = db.get(Server, server_id)
    if node is None or server is None:
        return
    try:
        await vm_lifecycle.export_vm(node, server.vm_id, server.org_id, storage_key(server))
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else str(error)
        with get_session() as db:
            stored = db.get(Server, server_id)
            if stored is not None and stored.deleted_at is None:
                stored.status = "running"
                stored.status_detail = f"stop failed: {str(detail)[:1900]}"
                db.add(stored)
                db.commit()
        return
    print(f"[timing] server stop {server_id}: export={time.monotonic() - t0:.1f}s", flush=True)
    with get_session() as db:
        stored = db.get(Server, server_id)
        if stored is not None and stored.deleted_at is None:
            stored.status = "stopped"
            stored.status_detail = None
            db.add(stored)
            db.commit()
    await warm_pool.ensure_node_has_warm_sandboxes(node_id)


@router.post("/{server_id}/start")
async def start_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        if server.status == "running":
            return with_node(server, node)
        if server.status != "stopped":
            raise HTTPException(409, f"server is {server.status}; it cannot be started")
        node = await vm_lifecycle.find_capacity_node(db, server.org_id)

        previous_node_id = server.node_id
        server.node_id = node.id
        server.status = "provisioning"
        db.add(server)
        db.commit()
    asyncio.create_task(_start_task(server_id, node.id, previous_node_id))
    return with_node(server, node)


async def _start_task(server_id: str, node_id: str, previous_node_id: str) -> None:
    t0 = time.monotonic()
    with get_session() as db:
        node = db.get(Node, node_id)
        server = db.get(Server, server_id)
    if node is None or server is None:
        return
    try:
        await vm_lifecycle.restore_vm(node, server.vm_id, server.org_id, storage_key(server))
        t1 = time.monotonic()
        commands, start = relaunch_commands(server_config(server))
        await vm_lifecycle.run_launch(node, server.vm_id, setup=commands, start=start)
        print(f"[timing] server start {server_id}: restore={t1 - t0:.1f}s relaunch={time.monotonic() - t1:.1f}s", flush=True)
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else str(error)
        with get_session() as db:
            stored = db.get(Server, server_id)
            if stored is not None and stored.deleted_at is None:
                stored.node_id = previous_node_id
                stored.status = "stopped"
                stored.status_detail = f"start failed: {str(detail)[:1900]}"
                db.add(stored)
                db.commit()
        return
    with get_session() as db:
        stored = db.get(Server, server_id)
        if stored is not None and stored.deleted_at is None:
            stored.status = "running"
            stored.status_detail = None
            db.add(stored)
            db.commit()
    discard_manifest(server.org_id, storage_key(server))
    await warm_pool.reconcile_node_warm_pool(node_id)


@router.post("/{server_id}/retry")
async def retry_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> ServerWithNode:
    """Re-run provisioning for a failed server."""
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        if server.status != "failed":
            raise HTTPException(409, f"server is {server.status}; only a failed server can be retried")
        if manifest_path(server.org_id, storage_key(server)).exists():
            # Its disk is already exported; the true state is stopped.
            server.status = "stopped"
            server.status_detail = None
            db.add(server)
            db.commit()
            db.refresh(server)
            return with_node(server, node)
        server.status = "provisioning"
        server.status_detail = None
        db.add(server)
        db.commit()
        db.refresh(server)
    asyncio.create_task(provision_server(server.id, node.id))
    return with_node(server, node)


@router.delete("/{server_id}", status_code=204)
async def delete_server(server_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    # Tombstone first, then read vm_id back: a provision finishing mid-delete
    # commits its vm_id before this update, so the VM is never orphaned.
    with get_session() as db:
        server, node = owned_server(db, server_id, ctx.membership.organization_id)
        was_stopped = server.status == "stopped"
        server.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(server)
        db.commit()
        db.refresh(server)
        vm_id = server.vm_id
    if was_stopped:
        discard_manifest(server.org_id, storage_key(server))
    elif vm_id:
        await _discard_vm(node, vm_id)
    await warm_pool.ensure_node_has_warm_sandboxes(node.id)
