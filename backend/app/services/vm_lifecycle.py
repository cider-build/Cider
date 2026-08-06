"""Shared VM export, restore, placement, and launch operations."""

import uuid

from fastapi import HTTPException

from ..models import Node
from ..models.base import utc_now
from ..snapshot_store import discard_manifest, read_manifest, write_manifest
from . import node_transport, warm_pool
from .node_gateway import node_gateway


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


async def restore_vm(node: Node, vm_id: str, org_id: str, key: str) -> None:
    manifest = read_manifest(org_id, key)
    await node_transport.request(
        node,
        "POST",
        f"/sandboxes/{vm_id}/restore",
        json={"manifest": manifest},
    )


async def find_capacity_node(db, org_id: str, node_id: str | None = None) -> Node:
    """Select a connected node and evict a warm VM when necessary."""
    if node_id is not None:
        node = db.get(Node, node_id)
        if node is None or node.org_id != org_id or not node_gateway.is_connected(node.id):
            raise HTTPException(404, "connected destination node not found")
        candidates = [node]
    else:
        candidates = warm_pool.available_nodes(db, org_id)
        if not candidates:
            raise HTTPException(404, "no connected nodes")

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
