import { MonitorUp } from "lucide-react";
import type { MetricSample } from "../../api";
import { MetricChart } from "../metric-chart/metric-chart";
import {
  MEBIBYTE,
  chartPoints,
} from "../resource-metrics/resource-metrics.utils";
import styles from "./graphics-panel.module.css";

export function GraphicsPanel({
  samples,
  duration,
  end,
}: {
  samples: MetricSample[];
  duration: number;
  end: number;
}) {
  const values = samples.map(
    (sample) => sample.graphics_memory_bytes / MEBIBYTE,
  );
  const current = values.at(-1);
  const maximum = Math.max(256, ...values);

  return (
    <section className={styles.metricPanel}>
      <div className={styles.metricHeader}>
        <div className={styles.metricName}>
          <MonitorUp size={16} />
          <h2>Graphics</h2>
        </div>
        <strong>
          {current === undefined ? "—" : `${current.toFixed(0)} MB`}
        </strong>
      </div>
      <MetricChart
        label="Graphics memory"
        points={chartPoints(
          samples,
          duration,
          maximum,
          (sample) => sample.graphics_memory_bytes / MEBIBYTE,
          end,
        )}
        duration={duration}
        end={end}
        maximum={maximum}
        formatValue={(metric) => `${metric.toFixed(0)} MB`}
      />
      <div className={styles.summary}>
        <span>VM graphics memory</span>
        <span>
          Peak
          {" "}
          <strong>
            {values.length === 0 ? "—" : `${Math.max(...values).toFixed(0)} MB`}
          </strong>
        </span>
      </div>
    </section>
  );
}
