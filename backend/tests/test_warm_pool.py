import unittest
from contextlib import contextmanager
from unittest.mock import AsyncMock, Mock, patch

from app.models import Node, Sandbox
from app.services import warm_pool


class WarmPoolTests(unittest.IsolatedAsyncioTestCase):
    def tearDown(self) -> None:
        warm_pool.warming.clear()

    def test_stopped_pool_vm_does_not_consume_active_capacity(self) -> None:
        node = Node(id="node", name="node", org_id="org", vm_count=1)
        with (
            patch.object(warm_pool, "live_sandboxes", return_value=[Sandbox(id="warm", node_id=node.id, status="warm")]),
            patch.object(warm_pool, "running_server_count", return_value=0),
        ):
            self.assertTrue(warm_pool.node_has_vm_capacity(Mock(), node))

    async def test_pool_creation_syncs_and_stops_vm(self) -> None:
        node = Node(id="node", name="node", org_id="org", sandbox_cpu_count=4, sandbox_memory_bytes=3 * 1024**3)
        lookup = Mock()
        lookup.get.return_value = node
        store = Mock()
        sessions = iter([lookup, store])

        @contextmanager
        def get_session():
            yield next(sessions)

        response = Mock()
        response.json.return_value = {"id": "cider-primed"}
        with (
            patch.object(warm_pool, "get_session", get_session),
            patch.object(warm_pool.vm_lifecycle, "create_vm", AsyncMock(return_value=response)),
            patch.object(warm_pool.node_transport, "request", AsyncMock()) as request,
        ):
            await warm_pool.warm_one(node.id)

        self.assertEqual(request.await_args_list[0].args[2], "/sandboxes/cider-primed/execute")
        self.assertEqual(request.await_args_list[1].args[2], "/sandboxes/cider-primed/stop")
        self.assertEqual(store.add.call_args.args[0].status, "warm")


if __name__ == "__main__":
    unittest.main()
