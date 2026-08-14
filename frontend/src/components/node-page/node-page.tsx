import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { deleteNode, getNode, updateNodeConfiguration } from "../../api";
import type { Node, NodeConfiguration, NodeMetadata } from "../../api";
import { Button, StatusText } from "../ui/ui";
import {
  DetailHead,
  DetailPane,
  DetailSection,
  Facts,
  Signals,
} from "../ui/detail";
import styles from "./node-page.module.css";

const gb = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const GIBIBYTE = 1024 ** 3;

function gibibytes(bytes: number) {
  return bytes / GIBIBYTE;
}

function displayGib(bytes: number) {
  return `${gb.format(gibibytes(bytes))} GiB`;
}

function inputGib(bytes: number) {
  return String(Math.round(gibibytes(bytes) * 10) / 10);
}

function requiredNodeId(value: string | undefined) {
  if (value === undefined) throw new Error("node route is missing a node ID");
  return value;
}

function savedConfigurationError(
  metadata: NodeMetadata,
  configuration: NodeConfiguration,
) {
  if (
    configuration.sandbox_cpu_count * configuration.vm_count >
    metadata.cpu_count
  ) {
    return `The saved CPU allocation is above current capacity. With ${configuration.vm_count} VMs, CPUs per VM must be ${Math.floor(metadata.cpu_count / configuration.vm_count)} or less.`;
  }
  if (
    configuration.sandbox_memory_bytes * configuration.vm_count >
    metadata.memory_bytes
  ) {
    return `The saved memory allocation is above current capacity. With ${configuration.vm_count} VMs, memory per VM must be ${gb.format(gibibytes(metadata.memory_bytes) / configuration.vm_count)} GiB or less.`;
  }
  if (
    configuration.sandbox_storage_bytes * configuration.vm_count >
    metadata.storage_available_bytes
  ) {
    return `The saved storage allocation is above current capacity. With ${configuration.vm_count} VMs, storage per VM must be ${gb.format(gibibytes(metadata.storage_available_bytes) / configuration.vm_count)} GiB or less.`;
  }
  return null;
}

function maximumMemoryGib(metadata: NodeMetadata, vmCount: 1 | 2) {
  return Math.floor((gibibytes(metadata.memory_bytes) / vmCount) * 10) / 10;
}

function maximumStorageGib(metadata: NodeMetadata, vmCount: 1 | 2) {
  return (
    Math.floor((gibibytes(metadata.storage_available_bytes) / vmCount) * 10) /
    10
  );
}

function ConfigurationForm({
  node,
  metadata,
  configuration,
}: {
  node: Node;
  metadata: NodeMetadata;
  configuration: NodeConfiguration;
}) {
  const queryClient = useQueryClient();
  const persistedValues = {
    vmCount: configuration.vm_count,
    cpuCount: configuration.sandbox_cpu_count,
    memoryGib: Number(inputGib(configuration.sandbox_memory_bytes)),
    storageGib: Number(inputGib(configuration.sandbox_storage_bytes)),
  };
  const initialValues = {
    vmCount: persistedValues.vmCount,
    cpuCount: Math.min(
      configuration.sandbox_cpu_count,
      Math.floor(metadata.cpu_count / configuration.vm_count),
    ),
    memoryGib: Math.min(
      Number(inputGib(configuration.sandbox_memory_bytes)),
      maximumMemoryGib(metadata, configuration.vm_count),
    ),
    storageGib: Math.min(
      Number(inputGib(configuration.sandbox_storage_bytes)),
      maximumStorageGib(metadata, configuration.vm_count),
    ),
  };
  const [vmCount, setVmCount] = useState<1 | 2>(initialValues.vmCount);
  const [cpuCount, setCpuCount] = useState(initialValues.cpuCount);
  const [memoryGib, setMemoryGib] = useState(initialValues.memoryGib);
  const [storageGib, setStorageGib] = useState(initialValues.storageGib);
  const [savedValues, setSavedValues] = useState(persistedValues);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(() =>
    savedConfigurationError(metadata, configuration),
  );
  const update = useMutation({
    mutationFn: (body: NodeConfiguration) =>
      updateNodeConfiguration(node.id, body),
    onSuccess: async (updated, saved) => {
      setSavedValues({
        vmCount: saved.vm_count,
        cpuCount: saved.sandbox_cpu_count,
        memoryGib: Number(inputGib(saved.sandbox_memory_bytes)),
        storageGib: Number(inputGib(saved.sandbox_storage_bytes)),
      });
      queryClient.setQueryData(["node", node.id], updated);
      setShowSavedFeedback(true);
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });

  useEffect(() => {
    if (!showSavedFeedback) return;
    const timeout = window.setTimeout(() => setShowSavedFeedback(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [showSavedFeedback]);

  function edited(setter: (value: number) => void, value: number) {
    setter(value);
    setValidationError(null);
    setShowSavedFeedback(false);
    update.reset();
  }

  function selectVmCount(value: 1 | 2) {
    setVmCount(value);
    setCpuCount((current) =>
      Math.min(current, Math.floor(metadata.cpu_count / value)),
    );
    setMemoryGib((current) =>
      Math.min(current, maximumMemoryGib(metadata, value)),
    );
    setStorageGib((current) =>
      Math.min(current, maximumStorageGib(metadata, value)),
    );
    setValidationError(null);
    setShowSavedFeedback(false);
    update.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);
    update.mutate({
      vm_count: vmCount,
      sandbox_cpu_count: cpuCount,
      sandbox_memory_bytes: Math.round(memoryGib * GIBIBYTE),
      sandbox_storage_bytes: Math.round(storageGib * GIBIBYTE),
    });
  }

  const error = validationError ?? update.error?.message;
  const dirty =
    vmCount !== savedValues.vmCount ||
    cpuCount !== savedValues.cpuCount ||
    memoryGib !== savedValues.memoryGib ||
    storageGib !== savedValues.storageGib;

  return (
    <section className={`${styles.card} ${styles.raised}`}>
      <h3>Sandbox configuration</h3>
      <p className={styles.desc}>
        {displayGib(metadata.storage_available_bytes)} is currently available on
        this Mac.
      </p>
      <form className={styles.cfgform} noValidate onSubmit={submit}>
        <div className={styles.vmrow}>
          <span>Concurrent VMs</span>
          <div className={styles.seg}>
            <button
              type="button"
              aria-pressed={vmCount === 1}
              onClick={() => selectVmCount(1)}
            >
              1
            </button>
            <button
              type="button"
              aria-pressed={vmCount === 2}
              onClick={() => selectVmCount(2)}
            >
              2
            </button>
          </div>
        </div>
        <div className={styles.sliders}>
          <label>
            <span className={styles.slTop}>
              <span>CPUs / VM</span>
              <output>{cpuCount} cores</output>
            </span>
            <input
              type="range"
              min={1}
              max={Math.floor(metadata.cpu_count / vmCount)}
              step={1}
              value={cpuCount}
              onChange={(event) =>
                edited(setCpuCount, Number(event.target.value))
              }
            />
            <span className={styles.slScale}>
              <span>1</span>
              <span>{Math.floor(metadata.cpu_count / vmCount)} max</span>
            </span>
          </label>
          <label>
            <span className={styles.slTop}>
              <span>Memory / VM</span>
              <output>{gb.format(memoryGib)} GiB</output>
            </span>
            <input
              type="range"
              min={1}
              max={maximumMemoryGib(metadata, vmCount)}
              step={0.1}
              value={memoryGib}
              onChange={(event) =>
                edited(setMemoryGib, Number(event.target.value))
              }
            />
            <span className={styles.slScale}>
              <span>1 GiB</span>
              <span>
                {gb.format(maximumMemoryGib(metadata, vmCount))} GiB max
              </span>
            </span>
          </label>
          <label>
            <span className={styles.slTop}>
              <span>Storage / VM</span>
              <output>{gb.format(storageGib)} GiB</output>
            </span>
            <input
              type="range"
              min={1}
              max={maximumStorageGib(metadata, vmCount)}
              step={0.1}
              value={storageGib}
              onChange={(event) =>
                edited(setStorageGib, Number(event.target.value))
              }
            />
            <span className={styles.slScale}>
              <span>1 GiB</span>
              <span>
                {gb.format(maximumStorageGib(metadata, vmCount))} GiB max
              </span>
            </span>
          </label>
        </div>
        {error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}
        <div className={styles.cfgfoot}>
          <Button
            kind="primary"
            type="submit"
            aria-live="polite"
            disabled={!node.connected || update.isPending || !dirty}
          >
            {update.isPending ? (
              "Saving…"
            ) : showSavedFeedback ? (
              <>
                <Check size={15} strokeWidth={3} /> Saved
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function NodePage() {
  const nodeId = requiredNodeId(useParams().nodeId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const node = useQuery({
    queryKey: ["node", nodeId],
    queryFn: () => getNode(nodeId),
  });
  const remove = useMutation({
    mutationFn: () => deleteNode(nodeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
      navigate("/nodes");
    },
  });

  if (node.status === "pending")
    return <p className={styles.desc}>Loading node</p>;
  if (node.error)
    return (
      <p className={styles.alert} role="alert">
        {node.error.message}
      </p>
    );

  const metadata = node.data.metadata;
  const configuration = node.data.configuration;
  const usedBytes = metadata
    ? metadata.storage_total_bytes - metadata.storage_available_bytes
    : 0;
  const usedShare =
    metadata && metadata.storage_total_bytes > 0
      ? Math.round((usedBytes / metadata.storage_total_bytes) * 100)
      : 0;

  return (
    <section>
      <DetailHead
        title={node.data.name}
        id={node.data.id}
        actions={
          <>
            <Button kind="quiet" onClick={() => navigate("/nodes")}>
              ← Nodes
            </Button>
            <Button
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove node \u201C${node.data.name}\u201D from your account? Its servers must be deleted first, and running sandboxes on it become unreachable.`,
                  )
                ) {
                  remove.mutate();
                }
              }}
            >
              {remove.isPending ? "Removing" : "Remove node"}
            </Button>
          </>
        }
      />
      <DetailPane>
        <Signals
          items={[
            {
              label: "Connection",
              value: node.data.connected ? "Connected" : "Offline",
            },
            { label: "Disk used", value: metadata ? `${usedShare}%` : "—" },
            {
              label: "CPU",
              value: metadata ? `${metadata.cpu_count} cores` : "—",
            },
            {
              label: "Memory",
              value: metadata ? displayGib(metadata.memory_bytes) : "—",
            },
          ]}
        />
        {remove.error && (
          <p className={styles.alert} role="alert">
            {remove.error.message}
          </p>
        )}
        {metadata ? (
          <Facts
            items={[
              ["Model", metadata.hardware_model],
              ["Chip", metadata.chip],
              ["CPU", `${metadata.cpu_count} cores`],
              ["Memory", displayGib(metadata.memory_bytes)],
              ["Storage", displayGib(metadata.storage_total_bytes)],
              [
                "Storage in use",
                `${displayGib(usedBytes)} of ${displayGib(metadata.storage_total_bytes)}`,
              ],
              ["Operating system", `macOS ${metadata.macos_version}`],
              [
                "Connection",
                <StatusText
                  key="c"
                  label={node.data.connected ? "Connected" : "Offline"}
                />,
              ],
            ]}
          />
        ) : (
          <p className={styles.desc}>
            Reconnect this node to report its hardware.
          </p>
        )}
        {metadata && configuration && (
          <DetailSection title="Sandbox allocation">
            <ConfigurationForm
              key={node.data.id}
              node={node.data}
              metadata={metadata}
              configuration={configuration}
            />
          </DetailSection>
        )}
      </DetailPane>
    </section>
  );
}
