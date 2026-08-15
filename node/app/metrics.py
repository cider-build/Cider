import re

from pydantic import BaseModel

from . import lume
from .errors import NodeOperationError


class VmMetrics(BaseModel):
    cpu_percent: float
    memory_percent: float
    graphics_memory_bytes: int


METRIC_COMMAND = r"""
printf '__CPU__\n'
LC_ALL=C top -l 1 -n 0 -F -R | awk '/CPU usage:/ { print; exit }'
printf '__MEMORY__\n'
LC_ALL=C memory_pressure -Q | awk '/System-wide memory free percentage:/ { print; exit }'
printf '__GRAPHICS__\n'
ioreg -r -d 1 -c AppleParavirtGPU | awk '/"PerformanceStatistics"/ { print; exit }'
"""

CPU_PATTERN = re.compile(r"CPU usage: [0-9.]+% user, [0-9.]+% sys, ([0-9.]+)% idle")
MEMORY_PATTERN = re.compile(r"System-wide memory free percentage: ([0-9]+)%")
GRAPHICS_PATTERN = re.compile(r'"In use system memory"=([0-9]+)')


async def collect(vm_id: str) -> VmMetrics:
    output = await lume.execute(vm_id, METRIC_COMMAND)
    cpu = CPU_PATTERN.search(output)
    memory = MEMORY_PATTERN.search(output)
    graphics = GRAPHICS_PATTERN.search(output)
    if cpu is None or memory is None or graphics is None:
        raise NodeOperationError("VM returned incomplete metrics")

    cpu_percent = 100 - float(cpu.group(1))
    memory_percent = 100 - float(memory.group(1))
    if not 0 <= cpu_percent <= 100 or not 0 <= memory_percent <= 100:
        raise NodeOperationError("VM returned invalid metric percentages")

    return VmMetrics(
        cpu_percent=cpu_percent,
        memory_percent=memory_percent,
        graphics_memory_bytes=int(graphics.group(1)),
    )
