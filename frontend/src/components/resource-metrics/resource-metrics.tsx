import { useQuery } from "@tanstack/react-query";
import { Cpu, MemoryStick } from "lucide-react";
import { useSearchParams } from "react-router";
import { getResourceMetrics } from "../../api";
import { GraphicsPanel } from "../graphics-panel/graphics-panel";
import { PercentPanel } from "../percent-panel/percent-panel";
import { WINDOWS, windowValue } from "./resource-metrics.utils";
import type { ResourceKind } from "./resource-metrics.utils";
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
  const window = windowValue(search.get("window"));
  const selectedWindow = WINDOWS.find((item) => item.value === window);
  if (selectedWindow === undefined)
    throw new Error(`Missing metric window: ${window}`);

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
                <PercentPanel
                  title="CPU"
                  icon={<Cpu size={16} />}
                  samples={samples}
                  duration={selectedWindow.duration}
                  end={chartEnd}
                  value={(sample) => sample.cpu_percent}
                />
                <PercentPanel
                  title="Memory"
                  icon={<MemoryStick size={16} />}
                  samples={samples}
                  duration={selectedWindow.duration}
                  end={chartEnd}
                  value={(sample) => sample.memory_percent}
                />
                <GraphicsPanel
                  samples={samples}
                  duration={selectedWindow.duration}
                  end={chartEnd}
                />
              </div>
            )}
    </section>
  );
}
