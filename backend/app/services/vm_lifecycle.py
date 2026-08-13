"""Shared VM export, restore, placement, and launch operations."""

import uuid

from fastapi import HTTPException

from ..models import Node
from ..models.base import utc_now
from ..snapshot_store import discard_manifest, read_manifest, write_manifest
from . import node_transport, warm_pool
from .node_gateway import node_gateway


def resolve_resources(
    node: Node,
    cpu_count: int | None = None,
    memory_bytes: int | None = None,
) -> tuple[int, int]:
    if node.sandbox_cpu_count is None or node.sandbox_memory_bytes is None:
        raise HTTPException(409, "node VM resources are not configured")
    resolved_cpu = node.sandbox_cpu_count if cpu_count is None else cpu_count
    resolved_memory = node.sandbox_memory_bytes if memory_bytes is None else memory_bytes
    if resolved_cpu < 1:
        raise HTTPException(422, "VM CPU count must be at least one")
    if resolved_memory < 1024**3:
        raise HTTPException(422, "VM memory must be at least 1 GiB")
    if resolved_memory % 1024**2 != 0:
        raise HTTPException(422, "VM memory must be a multiple of 1 MiB")
    if resolved_cpu > node.sandbox_cpu_count:
        raise HTTPException(422, f"this node permits at most {node.sandbox_cpu_count} CPUs per VM")
    if resolved_memory > node.sandbox_memory_bytes:
        raise HTTPException(422, f"this node permits at most {node.sandbox_memory_bytes} bytes of memory per VM")
    return resolved_cpu, resolved_memory


def stored_resources(config: dict | None, resource_name: str) -> tuple[int | None, int | None]:
    resources = (config or {}).get("resources", {})
    if not isinstance(resources, dict):
        raise HTTPException(500, f"{resource_name} resource metadata is invalid")
    cpu_count = resources.get("cpu_count")
    memory_bytes = resources.get("memory_bytes")
    if cpu_count is not None and not isinstance(cpu_count, int):
        raise HTTPException(500, f"{resource_name} CPU metadata is invalid")
    if memory_bytes is not None and not isinstance(memory_bytes, int):
        raise HTTPException(500, f"{resource_name} memory metadata is invalid")
    return cpu_count, memory_bytes


async def create_vm(
    node: Node,
    cpu_count: int | None = None,
    memory_bytes: int | None = None,
    **kwargs,
):
    resolved_cpu, resolved_memory = resolve_resources(node, cpu_count, memory_bytes)
    response = await node_transport.request(
        node,
        "POST",
        f"/sandboxes?cpu_count={resolved_cpu}&memory_bytes={resolved_memory}",
        **kwargs,
    )
    return response


async def configure_vm(
    node: Node,
    vm_id: str,
    cpu_count: int | None = None,
    memory_bytes: int | None = None,
) -> tuple[int, int]:
    resolved_cpu, resolved_memory = resolve_resources(node, cpu_count, memory_bytes)
    await node_transport.request(
        node,
        "POST",
        f"/sandboxes/{vm_id}/configuration",
        json={"cpu_count": resolved_cpu, "memory_bytes": resolved_memory},
    )
    return resolved_cpu, resolved_memory


async def export_vm(node: Node, vm_id: str, org_id: str, key: str) -> None:
    response = await node_transport.request(
        node,
        "POST",
        f"/sandboxes/{vm_id}/portable-snapshots",
        json={"snapshot": uuid.uuid4().hex},
    )
    manifest = response.json()["manifest"]
    try:
        write_manifest(org_id, key, manifest)
    except Exception as error:
        discard_manifest(org_id, key)
        raise HTTPException(500, f"export could not be saved: {error}") from error
    try:
        await node_transport.request(node, "DELETE", f"/sandboxes/{vm_id}")
    except HTTPException as error:
        raise HTTPException(
            500,
            f"the export was saved, but removing its stopped VM failed: {error.detail}",
        ) from error


async def restore_vm(
    node: Node,
    vm_id: str,
    org_id: str,
    key: str,
    cpu_count: int | None = None,
    memory_bytes: int | None = None,
) -> None:
    resolved_cpu, resolved_memory = resolve_resources(node, cpu_count, memory_bytes)
    manifest = read_manifest(org_id, key)
    await node_transport.request(
        node,
        "POST",
        (
            f"/sandboxes/{vm_id}/restore"
            f"?cpu_count={resolved_cpu}"
            f"&memory_bytes={resolved_memory}"
        ),
        json={"manifest": manifest},
    )


async def vm_state(node: Node, vm_id: str) -> str | None:
    response = await node_transport.request(node, "GET", "/sandboxes")
    for vm in response.json():
        if vm["id"] == vm_id:
            return vm["status"]
    return None


async def start_vm(node: Node, vm_id: str) -> None:
    await node_transport.request(node, "POST", f"/sandboxes/{vm_id}/start")


async def find_capacity_node(
    db,
    org_id: str,
    node_id: str | None = None,
    cpu_count: int | None = None,
    memory_bytes: int | None = None,
) -> Node:
    """Select a connected node and evict a warm VM when necessary."""
    if node_id is not None:
        node = db.get(Node, node_id)
        if node is None or node.org_id != org_id or not node_gateway.is_connected(node.id):
            raise HTTPException(404, "connected destination node not found")
        candidates = warm_pool.nodes_with_resources([node], cpu_count, memory_bytes, node_id)
    else:
        connected = warm_pool.available_nodes(db, org_id)
        if not connected:
            raise HTTPException(404, "no connected nodes")
        candidates = warm_pool.nodes_with_resources(
            connected,
            cpu_count,
            memory_bytes,
            node_id,
        )

    for candidate in candidates:
        if warm_pool.node_has_vm_capacity(db, candidate):
            return candidate
        warm = warm_pool.warm_sandbox(db, candidate.id)
        if warm is not None:
            await node_transport.request(candidate, "DELETE", f"/sandboxes/{warm.id}")
            warm.deleted_at = utc_now()
            db.add(warm)
            db.commit()
            return candidate
    raise HTTPException(429, "every connected node is at its VM capacity; stop something first")


async def run_launch(node: Node, vm_id: str, setup: list[str] | None = None, start: str | None = None) -> None:
    payload: dict = {}
    if setup:
        payload["setup"] = setup
    if start:
        payload["start"] = start
    if payload:
        await node_transport.request(node, "POST", f"/sandboxes/{vm_id}/launch-config", json=payload)
