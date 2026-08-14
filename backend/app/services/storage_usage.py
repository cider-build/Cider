from pydantic import BaseModel, Field

from ..db import get_session
from ..models import Node
from . import node_transport


class StorageUsage(BaseModel):
    used_bytes: int = Field(ge=0)


async def measure_vm_storage(node: Node, vm_id: str) -> int:
    response = await node_transport.request(node, "GET", f"/sandboxes/{vm_id}/storage-usage")
    return StorageUsage.model_validate(response.json()).used_bytes


def record(model: type, row_id: str, used_bytes: int) -> None:
    """Write a measurement to one row in a fresh session."""
    with get_session() as db:
        stored = db.get(model, row_id)
        if stored is None:
            return
        stored.storage_used_bytes = used_bytes
        db.add(stored)
        db.commit()
