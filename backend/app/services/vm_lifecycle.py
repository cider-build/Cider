"""Shared VM lifecycle: one implementation for sandboxes and servers.

Sandboxes and servers are the same thing under the hood — a VM that can be
exported to Cider storage and restored onto any connected node. The only
differences live in the callers: what triggers an export (pause vs stop),
what a row is called, and whether a TTL applies.

"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import select

from ..models import Node, Sandbox
from ..snapshot_store import discard_manifest, read_manifest, write_manifest
from . import node_transport, warm_pool
from .node_gateway import node_gateway


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def export_vm(node: Node, vm_id: str, org_id: str, key: str) -> None:
    """Snapshot a VM's disk into Cider storage under `key`, then destroy the VM.

    Frees the node's slot and disk. The caller updates its own row's status.
    """
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
    """Rebuild a VM on `node` from the export stored under `key`."""
    manifest = read_manifest(org_id, key)
    await node_transport.request(
        node,
        "POST",
        f"/sandboxes/{vm_id}/restore",
        json={"manifest": manifest},
    )


async def find_capacity_node(db, org_id: str, node_id: str | None = None) -> Node:
    """Pick a connected node with a free VM slot, evicting a warm VM if needed.

    With node_id, only that node is considered. Raises a clear 404/429.
    """
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
        warm = db.exec(
            select(Sandbox).where(
                Sandbox.node_id == candidate.id,
                Sandbox.deleted_at.is_(None),
                Sandbox.status == "warm",
            )
        ).first()
        if warm is not None:
            await node_transport.request(candidate, "DELETE", f"/sandboxes/{warm.id}")
            warm.deleted_at = _now()
            db.add(warm)
            db.commit()
            return candidate
    raise HTTPException(429, "every connected node is at its VM capacity; stop something first")


async def run_launch(node: Node, vm_id: str, setup: list[str] | None = None, start: str | None = None) -> None:
    """Run setup commands and launch the start process inside a VM."""
    payload: dict = {}
    if setup:
        payload["setup"] = setup
    if start:
        payload["start"] = start
    if payload:
        await node_transport.request(node, "POST", f"/sandboxes/{vm_id}/launch-config", json=payload)
