#!/usr/bin/env python3
"""Measure cold Cider VM lifecycle operations."""

import argparse
import asyncio
import json
import math
import os
import platform
import shutil
import statistics
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"


class BenchmarkError(RuntimeError):
    pass


def format_time(value: float) -> str:
    return f"{value * 1000:.0f} ms" if value < 1 else f"{value:.2f} s"


def percentile(values: list[float], fraction: float) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


class Terminal:
    def __init__(self) -> None:
        self.color = sys.stdout.isatty() and os.environ.get("TERM") != "dumb"

    def style(self, text: str, *codes: str) -> str:
        return f"{''.join(codes)}{text}{RESET}" if self.color else text

    def header(self, data: dict) -> None:
        print(self.style("╭─ Cider cold lifecycle benchmark", BOLD, CYAN))
        print(f"│ Host       {data['host']['model']} · macOS {data['host']['macos']}")
        print(f"│ Lume       {data['lume_version']}")
        print(f"│ Base       {data['base_vm']} · {data['base_disk_gib']:.1f} GiB")
        print(f"│ Iterations {data['iterations']} · {data['cpu_count'] or 'base'} CPU · {data['memory_bytes'] or 'base'} bytes RAM")
        print(self.style("╰────────────────────────────────────────────", DIM), "\n")

    def stage(self, label: str, action: Callable[[], object]) -> tuple[float, object]:
        print(f"  {self.style('●', YELLOW)} {label:<27}", end="", flush=True)
        started = time.perf_counter()
        try:
            result = action()
        except BaseException:
            print(f" {self.style('✗', RED)} {format_time(time.perf_counter() - started):>9}")
            raise
        elapsed = time.perf_counter() - started
        print(f" {self.style('✓', GREEN)} {format_time(elapsed):>9}")
        return elapsed, result

    def summary(self, rows: list[tuple[str, float, float, float]]) -> None:
        print(self.style("Results", BOLD))
        print("┌─────────────────────────────┬───────────┬───────────┬───────────┐")
        print("│ Phase                       │    median │       p95 │       max │")
        print("├─────────────────────────────┼───────────┼───────────┼───────────┤")
        for label, median, p95, maximum in rows:
            print(f"│ {label:<27} │ {format_time(median):>9} │ {format_time(p95):>9} │ {format_time(maximum):>9} │")
        print("└─────────────────────────────┴───────────┴───────────┴───────────┘")


class Benchmark:
    def __init__(self, args: argparse.Namespace, terminal: Terminal) -> None:
        self.args = args
        self.terminal = terminal
        self.created: set[str] = set()
        sys.path.insert(0, str(Path(__file__).parents[2] / "node"))
        from app import config, lume

        config.BASE_VM = args.base_vm
        config.VM_STORAGE = args.storage
        config.VM_TRASH = str(Path(args.storage).parent / "benchmark-trash")
        config.VM_POLL_SECONDS = args.poll_seconds
        self.lume = lume
        self.loop = asyncio.new_event_loop()

    def async_run(self, coroutine):
        return self.loop.run_until_complete(coroutine)

    def guest(self, name: str, command: str) -> None:
        if self.args.ssh_password:
            self.command(
                self.args.lume, "ssh", name, command, "--user", self.args.ssh_user,
                "--password", self.args.ssh_password, "--timeout", "0",
                "--storage", self.args.storage,
            )
            return
        address = self.async_run(self.lume.ip(name))
        self.command(
            "ssh", "-i", self.args.ssh_key, "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
            f"{self.args.ssh_user}@{address}", command,
        )

    @staticmethod
    def command(*command: str) -> None:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            raise BenchmarkError(result.stderr.strip() or result.stdout.strip())

    def clone(self, name: str) -> None:
        self.async_run(self.lume.clone(self.args.base_vm, name, self.args.cpu_count, self.args.memory_bytes))
        self.created.add(name)

    def boot(self, name: str) -> None:
        async def start_ready() -> None:
            await self.lume.start(name)
            await self.lume.wait_until_ready(name)

        self.async_run(start_ready())

    def stop(self, name: str) -> None:
        self.async_run(self.lume.stop(name))

    def delete(self, name: str) -> None:
        self.async_run(self.lume.delete(name))
        self.created.discard(name)

    def measure(self, phases: dict, key: str, label: str, action: Callable[[], object]) -> object:
        elapsed, result = self.terminal.stage(label, action)
        phases[key] = elapsed
        return result

    def new_cold(self, phases: dict, full: bool) -> None:
        token = uuid.uuid4().hex[:10]
        vm = f"cider-bench-{token}"
        snapshot = f"cider-bench-snap-{token}"
        self.measure(phases, "clone_seconds", "Clone base", lambda: self.clone(vm))
        self.measure(phases, "cold_boot_seconds", "Cold boot to SSH", lambda: self.boot(vm))
        if full:
            self.measure(phases, "sync_seconds", "Guest sync", lambda: self.guest(vm, "/bin/sync"))
            self.measure(phases, "snapshot_seconds", "Live disk snapshot", lambda: self.async_run(self.lume.snapshot(vm, snapshot)))
            self.created.add(snapshot)
        self.measure(phases, "stop_seconds", "Stop VM", lambda: self.stop(vm))
        if full:
            self.measure(phases, "snapshot_boot_seconds", "Snapshot boot to SSH", lambda: self.boot(snapshot))
            self.measure(phases, "snapshot_stop_seconds", "Stop snapshot", lambda: self.stop(snapshot))
            self.measure(phases, "snapshot_delete_seconds", "Delete snapshot", lambda: self.delete(snapshot))
            self.measure(phases, "restart_seconds", "Stopped boot to SSH", lambda: self.boot(vm))
            self.measure(phases, "restart_stop_seconds", "Stop restarted VM", lambda: self.stop(vm))
        self.measure(phases, "delete_seconds", "Delete stopped VM", lambda: self.delete(vm))

    def prepared_cold(self, phases: dict) -> None:
        name = self.args.stopped_vm
        vm = self.async_run(self.lume.find(name))
        if vm is None or vm["status"] != "stopped":
            raise BenchmarkError(f"prepared VM is not stopped: {name}")
        if self.args.cpu_count is not None or self.args.memory_bytes is not None:
            path = Path(self.args.storage) / name / "config.json"
            vm_config = json.loads(path.read_text())
            cpu = self.args.cpu_count or vm_config["cpuCount"]
            memory = self.args.memory_bytes or vm_config["memorySize"]
            self.measure(phases, "configure_seconds", "Configure stopped VM", lambda: self.async_run(self.lume.configure(name, cpu, memory)))
        self.measure(phases, "cold_boot_seconds", "Cold boot to SSH", lambda: self.boot(name))
        self.measure(phases, "stop_seconds", "Stop VM", lambda: self.stop(name))

    def cleanup(self) -> None:
        for name in sorted(self.created):
            if self.async_run(self.lume.find(name)) is not None:
                self.async_run(self.lume.delete(name))
        self.async_run(self.lume.drain_deletes())
        self.loop.close()


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--mode", choices=("full", "cold", "prepared"), default="full")
    parser.add_argument("--stopped-vm")
    parser.add_argument("--base-vm", default=os.environ.get("CIDER_BASE_VM", "cider-base"))
    parser.add_argument("--storage", default=os.environ.get("CIDER_VM_STORAGE", str(Path.home() / ".cider/vms")))
    parser.add_argument("--lume", default=os.environ.get("LUME", shutil.which("lume")))
    parser.add_argument("--ssh-user", default=os.environ.get("CIDER_SSH_USER", "admin"))
    parser.add_argument("--ssh-key", default=os.environ.get("CIDER_SSH_KEY", str(Path.home() / ".cider/ssh_key")))
    parser.add_argument("--ssh-password", default=os.environ.get("CIDER_SSH_PASSWORD"))
    parser.add_argument("--cpu-count", type=int)
    parser.add_argument("--memory-bytes", type=int)
    parser.add_argument("--poll-seconds", type=float, default=0.1)
    parser.add_argument("--revision")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("--iterations must be at least 1")
    if args.mode == "prepared" and not args.stopped_vm:
        parser.error("--mode prepared requires --stopped-vm")
    if not args.lume:
        parser.error("Lume is not installed")
    if args.cpu_count is not None and args.cpu_count < 1:
        parser.error("--cpu-count must be at least 1")
    if args.memory_bytes is not None and (args.memory_bytes < 1024**3 or args.memory_bytes % 1024**2):
        parser.error("--memory-bytes must be at least 1 GiB and use whole MiB")
    return args


def metadata(args: argparse.Namespace) -> dict:
    base_disk = Path(args.storage) / args.base_vm / "disk.img"
    if not base_disk.is_file():
        raise BenchmarkError(f"base disk does not exist: {base_disk}")
    run = lambda command: subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()
    return {
        "schema_version": 1,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "revision": args.revision,
        "host": {"model": run(["sysctl", "-n", "hw.model"]), "machine": platform.machine(), "macos": run(["sw_vers", "-productVersion"])},
        "lume_version": run([args.lume, "--version"]),
        "base_vm": args.base_vm,
        "base_disk_gib": base_disk.stat().st_size / 1024**3,
        "iterations": args.iterations,
        "mode": args.mode,
        "cpu_count": args.cpu_count,
        "memory_bytes": args.memory_bytes,
        "readiness": "SSH command returns zero",
    }


LABELS = {
    "clone_seconds": "Clone base",
    "configure_seconds": "Configure stopped VM",
    "cold_boot_seconds": "Cold boot to SSH",
    "sync_seconds": "Guest sync",
    "snapshot_seconds": "Live disk snapshot",
    "stop_seconds": "Stop VM",
    "snapshot_boot_seconds": "Snapshot boot to SSH",
    "snapshot_stop_seconds": "Stop snapshot",
    "snapshot_delete_seconds": "Delete snapshot",
    "restart_seconds": "Stopped boot to SSH",
    "restart_stop_seconds": "Stop restarted VM",
    "delete_seconds": "Delete stopped VM",
}


def summarize(samples: list[dict]) -> tuple[dict, list[tuple[str, float, float, float]]]:
    summary = {}
    rows = []
    for key, label in LABELS.items():
        values = [sample[key] for sample in samples if key in sample]
        if len(values) != len(samples):
            continue
        item = {"median_seconds": statistics.median(values), "p95_seconds": percentile(values, 0.95), "max_seconds": max(values), "samples_seconds": values}
        summary[key] = item
        rows.append((label, item["median_seconds"], item["p95_seconds"], item["max_seconds"]))
    return summary, rows


def main() -> int:
    args = arguments()
    terminal = Terminal()
    result = metadata(args)
    terminal.header(result)
    benchmark = Benchmark(args, terminal)
    samples = []
    status = 0
    try:
        for index in range(1, args.iterations + 1):
            print(terminal.style(f"Iteration {index}/{args.iterations}", BOLD))
            phases = {"iteration": index}
            samples.append(phases)
            if args.mode == "prepared":
                benchmark.prepared_cold(phases)
            else:
                benchmark.new_cold(phases, args.mode == "full")
            print()
    except BaseException as error:
        result.update(status="failed", error=str(error))
        print(terminal.style(f"Benchmark failed: {error}", RED, BOLD), file=sys.stderr)
        status = 1
    else:
        result["status"] = "passed"
    finally:
        benchmark.cleanup()
        result["samples"] = samples
        result["summary"], rows = summarize(samples)
        if rows:
            terminal.summary(rows)
        result["finished_at"] = datetime.now(timezone.utc).isoformat()
        output = args.output or Path("artifacts/benchmarks") / f"lifecycle-{datetime.now():%Y%m%d-%H%M%S}.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        print(f"\nRaw results: {output.resolve()}")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
