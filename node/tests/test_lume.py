import base64
import json
import os
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import lume


class LumeLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        await lume.drain_deletes()

    @staticmethod
    def base_vm(directory: str) -> Path:
        vm = Path(directory) / "cider-base"
        vm.mkdir()
        (vm / "config.json").write_text(json.dumps({
            "machineIdentifier": "old-machine",
            "macAddress": "02:00:00:00:00:01",
            "cpuCount": 4,
            "memorySize": 3 * 1024**3,
        }))
        (vm / "disk.img").write_bytes(b"disk")
        (vm / "nvram.bin").write_bytes(b"nvram")
        return vm

    async def test_clone_uses_new_identity_and_requested_resources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.base_vm(directory)
            with (
                patch.object(lume.config, "VM_STORAGE", directory),
                patch.object(lume, "find", AsyncMock(return_value={"status": "stopped"})),
            ):
                await lume.clone("cider-base", "cider-clone", 2, 2 * 1024**3)

            cloned = json.loads((Path(directory) / "cider-clone" / "config.json").read_text())
            self.assertEqual(cloned["cpuCount"], 2)
            self.assertEqual(cloned["memorySize"], 2 * 1024**3)
            self.assertNotEqual(cloned["macAddress"], "02:00:00:00:00:01")
            identity = plistlib.loads(base64.b64decode(cloned["machineIdentifier"]))
            self.assertIsInstance(identity["ECID"], int)

    async def test_configure_updates_only_a_stopped_vm(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            vm = self.base_vm(directory)
            with (
                patch.object(lume.config, "VM_STORAGE", directory),
                patch.object(lume, "find", AsyncMock(return_value={"status": "stopped"})),
            ):
                await lume.configure("cider-base", 3, 4 * 1024**3)

            config = json.loads((vm / "config.json").read_text())
            self.assertEqual((config["cpuCount"], config["memorySize"]), (3, 4 * 1024**3))

    async def test_snapshot_excludes_runtime_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = self.base_vm(directory)
            (source / "sessions.json").write_text("runtime")
            with patch.object(lume.config, "VM_STORAGE", directory):
                await lume.snapshot("cider-base", "cider-snapshot")
            self.assertFalse((Path(directory) / "cider-snapshot" / "sessions.json").exists())

    async def test_delete_moves_vm_before_background_removal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "vms"
            trash = Path(directory) / "trash"
            vm = storage / "cider-test"
            vm.mkdir(parents=True)
            with (
                patch.object(lume.config, "VM_STORAGE", os.fspath(storage)),
                patch.object(lume.config, "VM_TRASH", os.fspath(trash)),
                patch.object(lume, "find", AsyncMock(return_value={"status": "stopped"})),
            ):
                await lume.delete("cider-test")
                self.assertFalse(vm.exists())
                await lume.drain_deletes()
                self.assertEqual(list(trash.iterdir()), [])

    async def test_create_waits_for_ssh(self) -> None:
        with (
            patch.object(lume, "clone", AsyncMock()),
            patch.object(lume, "start", AsyncMock()),
            patch.object(lume, "wait_until_ready", AsyncMock()) as ready,
        ):
            await lume.create("cider-test")
        ready.assert_awaited_once_with("cider-test")


if __name__ == "__main__":
    unittest.main()
