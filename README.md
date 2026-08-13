# Cider

MacOS Virtual Machine provisioning platform for software development.

work in progress.

## Cold lifecycle benchmark

Run the benchmark on an Apple Silicon Mac with Lume and a Cider base VM:

```sh
scripts/benchmark-lifecycle
```

The command measures clone, cold boot, snapshot, stop, restart, and delete times.
It writes JSON results to `artifacts/benchmarks/`.

Measure only new cold boots:

```sh
scripts/benchmark-lifecycle --mode cold --iterations 5
```

Measure repeated cold boots of one prepared, stopped VM:

```sh
scripts/benchmark-lifecycle --mode prepared --stopped-vm cider-VM_ID --iterations 5
```

Measure a specific cold CPU and memory configuration:

```sh
scripts/benchmark-lifecycle \
  --mode prepared \
  --stopped-vm cider-VM_ID \
  --cpu-count 3 \
  --memory-bytes 4294967296 \
  --iterations 5
```

## Cold-start design

Cider keeps prepared pool VMs stopped. They use disk space but no CPU or RAM.
Cider sets the requested CPU and RAM before each cold boot.
Cider does not use saved VM memory state.

Use these optional sandbox form fields:

- `cpu_count`
- `memory_bytes`

Use the same fields in a server `config` object.
