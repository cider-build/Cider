import type { NodeConfiguration, NodeMetadata } from "../../api";

export const gb = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
export const GIBIBYTE = 1024 ** 3;

function gibibytes(bytes: number) {
  return bytes / GIBIBYTE;
}

export function displayGib(bytes: number) {
  return `${gb.format(gibibytes(bytes))} GiB`;
}

export function roundedGib(bytes: number) {
  return Math.round(gibibytes(bytes) * 10) / 10;
}

export function savedConfigurationError(
  metadata: NodeMetadata,
  configuration: NodeConfiguration,
) {
  if (
    configuration.sandbox_cpu_count * configuration.vm_count
    > metadata.cpu_count
  ) {
    return `The saved CPU allocation is above current capacity. With ${configuration.vm_count} VMs, CPUs per VM must be ${Math.floor(metadata.cpu_count / configuration.vm_count)} or less.`;
  }
  if (
    configuration.sandbox_memory_bytes * configuration.vm_count
    > metadata.memory_bytes
  ) {
    return `The saved memory allocation is above current capacity. With ${configuration.vm_count} VMs, memory per VM must be ${gb.format(gibibytes(metadata.memory_bytes) / configuration.vm_count)} GiB or less.`;
  }
  if (
    configuration.sandbox_storage_bytes * configuration.vm_count
    > metadata.storage_available_bytes
  ) {
    return `The saved storage allocation is above current capacity. With ${configuration.vm_count} VMs, storage per VM must be ${gb.format(gibibytes(metadata.storage_available_bytes) / configuration.vm_count)} GiB or less.`;
  }
  return null;
}

export function maximumMemoryGib(metadata: NodeMetadata, vmCount: 1 | 2) {
  return Math.floor((gibibytes(metadata.memory_bytes) / vmCount) * 10) / 10;
}

export function maximumStorageGib(metadata: NodeMetadata, vmCount: 1 | 2) {
  return (
    Math.floor((gibibytes(metadata.storage_available_bytes) / vmCount) * 10)
    / 10
  );
}
