import type { ReactNode } from "react";
import type { MetricSample } from "../../api";
import { MetricChart } from "../metric-chart/metric-chart";
import {
  average,
  chartPoints,
} from "../resource-metrics/resource-metrics.utils";
import styles from "./percent-panel.module.css";

export function PercentPanel({
  title,
  icon,
  samples,
  duration,
  end,
  value,
}: {
  title: string;
  icon: ReactNode;
  samples: MetricSample[];
  duration: number;
  end: number;
  value: (sample: MetricSample) => number;
}) {
  const values = samples.map(value);
  const current = values.at(-1);

  return (
    <section className={styles.metricPanel}>
      <div className={styles.metricHeader}>
        <div className={styles.metricName}>
          {icon}
          <h2>{title}</h2>
        </div>
        <strong>
          {current === undefined ? "—" : `${current.toFixed(1)}%`}
        </strong>
      </div>
      <MetricChart
        label={title}
        points={chartPoints(samples, duration, 100, value, end)}
        duration={duration}
        end={end}
        maximum={100}
        formatValue={(metric) => `${metric.toFixed(0)}%`}
      />
      <div className={styles.summary}>
        <span>
          Average
          {" "}
          <strong>
            {values.length === 0 ? "—" : `${average(values).toFixed(1)}%`}
          </strong>
        </span>
        <span>
          Peak
          {" "}
          <strong>
            {values.length === 0 ? "—" : `${Math.max(...values).toFixed(1)}%`}
          </strong>
        </span>
      </div>
    </section>
  );
}
