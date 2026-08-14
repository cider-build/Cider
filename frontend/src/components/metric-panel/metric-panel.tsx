import type { ReactNode } from "react";
import type { MetricSample } from "../../api";
import { MetricChart } from "../metric-chart/metric-chart";
import { chartPoints } from "../resource-metrics/resource-metrics.utils";
import styles from "./metric-panel.module.css";

export function MetricPanel({
  title,
  chartLabel = title,
  icon,
  samples,
  duration,
  end,
  value,
  format,
  chartFormat = format,
  maximum = () => 100,
  summaryLeft,
}: {
  title: string;
  chartLabel?: string;
  icon: ReactNode;
  samples: MetricSample[];
  duration: number;
  end: number;
  value: (sample: MetricSample) => number;
  format: (metric: number) => string;
  chartFormat?: (metric: number) => string;
  maximum?: (values: number[]) => number;
  summaryLeft?: ReactNode;
}) {
  const values = samples.map(value);
  const current = values.at(-1);
  const top = maximum(values);
  const average
    = values.reduce((total, item) => total + item, 0) / values.length;

  return (
    <section className={styles.metricPanel}>
      <div className={styles.metricHeader}>
        <div className={styles.metricName}>
          {icon}
          <h2>{title}</h2>
        </div>
        <strong>{current === undefined ? "—" : format(current)}</strong>
      </div>
      <MetricChart
        label={chartLabel}
        points={chartPoints(samples, duration, top, value, end)}
        duration={duration}
        end={end}
        maximum={top}
        formatValue={chartFormat}
      />
      <div className={styles.summary}>
        {summaryLeft ?? (
          <span>
            Average
            {" "}
            <strong>
              {values.length === 0 ? "—" : format(average)}
            </strong>
          </span>
        )}
        <span>
          Peak
          {" "}
          <strong>
            {values.length === 0 ? "—" : format(Math.max(...values))}
          </strong>
        </span>
      </div>
    </section>
  );
}
