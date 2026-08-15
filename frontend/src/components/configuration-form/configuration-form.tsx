import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { updateNodeConfiguration } from "../../api";
import type { Node, NodeConfiguration, NodeMetadata } from "../../api";
import { Button } from "../ui";
import {
  gb,
  GIBIBYTE,
  displayGib,
  maximumMemoryGib,
  maximumStorageGib,
  roundedGib,
  savedConfigurationError,
} from "../node-page/node-page.utils";
import styles from "./configuration-form.module.css";

export function ConfigurationForm({
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
    memoryGib: roundedGib(configuration.sandbox_memory_bytes),
    storageGib: roundedGib(configuration.sandbox_storage_bytes),
  };
  const initialValues = {
    vmCount: persistedValues.vmCount,
    cpuCount: Math.min(
      persistedValues.cpuCount,
      Math.floor(metadata.cpu_count / configuration.vm_count),
    ),
    memoryGib: Math.min(
      persistedValues.memoryGib,
      maximumMemoryGib(metadata, configuration.vm_count),
    ),
    storageGib: Math.min(
      persistedValues.storageGib,
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
    savedConfigurationError(metadata, configuration));
  const update = useMutation({
    mutationFn: (body: NodeConfiguration) =>
      updateNodeConfiguration(node.id, body),
    onSuccess: async (updated, saved) => {
      setSavedValues({
        vmCount: saved.vm_count,
        cpuCount: saved.sandbox_cpu_count,
        memoryGib: roundedGib(saved.sandbox_memory_bytes),
        storageGib: roundedGib(saved.sandbox_storage_bytes),
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
      Math.min(current, Math.floor(metadata.cpu_count / value)));
    setMemoryGib((current) =>
      Math.min(current, maximumMemoryGib(metadata, value)));
    setStorageGib((current) =>
      Math.min(current, maximumStorageGib(metadata, value)));
    setValidationError(null);
    setShowSavedFeedback(false);
    update.reset();
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
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
  const dirty
    = vmCount !== savedValues.vmCount
      || cpuCount !== savedValues.cpuCount
      || memoryGib !== savedValues.memoryGib
      || storageGib !== savedValues.storageGib;

  return (
    <section className={styles.card}>
      <h3>Sandbox configuration</h3>
      <p className={styles.desc}>
        {displayGib(metadata.storage_available_bytes)}
        {" "}
        is currently available on
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
              <output>
                {cpuCount}
                {" "}
                cores
              </output>
            </span>
            <input
              type="range"
              min={1}
              max={Math.floor(metadata.cpu_count / vmCount)}
              step={1}
              value={cpuCount}
              onChange={(event) =>
                edited(setCpuCount, Number(event.target.value))}
            />
            <span className={styles.slScale}>
              <span>1</span>
              <span>
                {Math.floor(metadata.cpu_count / vmCount)}
                {" "}
                max
              </span>
            </span>
          </label>
          <label>
            <span className={styles.slTop}>
              <span>Memory / VM</span>
              <output>
                {gb.format(memoryGib)}
                {" "}
                GiB
              </output>
            </span>
            <input
              type="range"
              min={1}
              max={maximumMemoryGib(metadata, vmCount)}
              step={0.1}
              value={memoryGib}
              onChange={(event) =>
                edited(setMemoryGib, Number(event.target.value))}
            />
            <span className={styles.slScale}>
              <span>1 GiB</span>
              <span>
                {gb.format(maximumMemoryGib(metadata, vmCount))}
                {" "}
                GiB max
              </span>
            </span>
          </label>
          <label>
            <span className={styles.slTop}>
              <span>Storage / VM</span>
              <output>
                {gb.format(storageGib)}
                {" "}
                GiB
              </output>
            </span>
            <input
              type="range"
              min={1}
              max={maximumStorageGib(metadata, vmCount)}
              step={0.1}
              value={storageGib}
              onChange={(event) =>
                edited(setStorageGib, Number(event.target.value))}
            />
            <span className={styles.slScale}>
              <span>1 GiB</span>
              <span>
                {gb.format(maximumStorageGib(metadata, vmCount))}
                {" "}
                GiB max
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
            {update.isPending
              ? (
                  "Saving…"
                )
              : showSavedFeedback
                ? (
                    <>
                      <Check size={15} strokeWidth={3} />
                      {" "}
                      Saved
                    </>
                  )
                : (
                    "Save changes"
                  )}
          </Button>
        </div>
      </form>
    </section>
  );
}
