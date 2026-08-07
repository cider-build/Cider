from pydantic import BaseModel, Field

from ..models import Node
from . import node_transport


class StorageUsage(BaseModel):
    used_bytes: int = Field(ge=0)


async def measure_vm_storage(node: Node, vm_id: str) -> int:
    response = await node_transport.request(node, "GET", f"/sandboxes/{vm_id}/storage-usage")
    return StorageUsage.model_validate(response.json()).used_bytes
