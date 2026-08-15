import { useQuery } from "@tanstack/react-query";
import { Cpu, MemoryStick, MonitorUp } from "lucide-react";
import { useSearchParams } from "react-router";
import { getResourceMetrics } from "../../api";
import type { ResourceKind } from "../../api";
import { MetricPanel } from "../metric-panel/metric-panel";
import { MEBIBYTE, WINDOWS, windowOption } from "./resource-metrics.utils";
import styles from "./resource-metrics.module.css";

export function ResourceMetrics({
  kind,
  id,
  running,
}: {
  kind: ResourceKind;
  id: string;
  running: boolean;
}) {
  const [search, setSearch] = useSearchParams();
  const selectedWindow = windowOption(search.get("window"));
  const window = selectedWindow.value;

  const history = useQuery({
    queryKey: [kind, id, "metrics", window],
    queryFn: () => getResourceMetrics(kind, id, window),
    refetchInterval: running ? 30_000 : false,
  });
  const samples = history.data?.samples ?? [];
  const chartEnd = history.dataUpdatedAt;

  return (
    <section className={styles.metricsPage}>
      <header className={styles.pageHeader}>
        <div className={styles.windowPicker} aria-label="Metric time range">
          {WINDOWS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={window === item.value}
              onClick={() =>
                setSearch({ window: item.value }, { replace: true })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {history.status === "pending"
        ? (
            <div className={styles.state}>Loading metrics…</div>
          )
        : history.error
          ? (
              <div className={`${styles.state} ${styles.error}`} role="alert">
                {history.error.message}
              </div>
            )
          : (
              <div className={styles.metricsGrid}>
                <MetricPanel
                  title="CPU"
                  icon={<Cpu size={16} />}
                  samples={samples}
                  duration={selectedWindow.duration}
                  end={chartEnd}
                  value={(sample) => sample.cpu_percent}
                  format={(metric) => `${metric.toFixed(1)}%`}
                  chartFormat={(metric) => `${metric.toFixed(0)}%`}
                />
                <MetricPanel
                  title="Memory"
                  icon={<MemoryStick size={16} />}
                  samples={samples}
                  duration={selectedWindow.duration}
                  end={chartEnd}
                  value={(sample) => sample.memory_percent}
                  format={(metric) => `${metric.toFixed(1)}%`}
                  chartFormat={(metric) => `${metric.toFixed(0)}%`}
                />
                <MetricPanel
                  title="Graphics"
                  chartLabel="Graphics memory"
                  icon={<MonitorUp size={16} />}
                  samples={samples}
                  duration={selectedWindow.duration}
                  end={chartEnd}
                  value={(sample) => sample.graphics_memory_bytes / MEBIBYTE}
                  format={(metric) => `${metric.toFixed(0)} MB`}
                  maximum={(values) => Math.max(256, ...values)}
                  summaryLeft={<span>VM graphics memory</span>}
                />
              </div>
            )}
    </section>
  );
}
