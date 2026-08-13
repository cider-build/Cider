import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.models import Node
from app.services import vm_lifecycle


class VmLifecycleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.node = Node(
            id="node",
            name="node",
            org_id="org",
            sandbox_cpu_count=8,
            sandbox_memory_bytes=8 * 1024**3,
        )

    def test_resolve_resources_accepts_request_size(self) -> None:
        self.assertEqual(vm_lifecycle.resolve_resources(self.node, 3, 4 * 1024**3), (3, 4 * 1024**3))

    def test_resolve_resources_rejects_node_limit(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            vm_lifecycle.resolve_resources(self.node, 9, 4 * 1024**3)
        self.assertEqual(raised.exception.status_code, 422)

    async def test_configure_vm_applies_size_before_boot(self) -> None:
        with patch.object(vm_lifecycle.node_transport, "request", AsyncMock()) as request:
            await vm_lifecycle.configure_vm(self.node, "cider-stopped", 3, 4 * 1024**3)
        request.assert_awaited_once_with(
            self.node,
            "POST",
            "/sandboxes/cider-stopped/configuration",
            json={"cpu_count": 3, "memory_bytes": 4 * 1024**3},
        )


if __name__ == "__main__":
    unittest.main()
