import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, MemoryStick, MonitorUp } from "lucide-react";
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useSearchParams } from "react-router";
import { getResourceMetrics } from "../../api";
import type { MetricSample, MetricWindow } from "../../api";
import styles from "./resource-metrics.module.css";

type ResourceKind = "server" | "sandbox";
type Point = { x: number; y: number; time: number; value: number };

const MEBIBYTE = 1024 ** 2;
const WINDOWS: Array<{ value: MetricWindow; label: string; duration: number }> = [
  { value: "live", label: "Live", duration: 10 * 60_000 },
  { value: "1h", label: "1 hour", duration: 60 * 60_000 },
  { value: "24h", label: "24 hours", duration: 24 * 60 * 60_000 },
];

function pathFor(points: Point[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function chartPoints(
  samples: MetricSample[],
  duration: number,
  maximum: number,
  value: (sample: MetricSample) => number,
  end: number,
) {
  const start = end - duration;
  return samples.map((sample) => {
    const sampleValue = value(sample);
    const time = new Date(sample.collected_at).getTime();
    return {
      x: Math.max(0, Math.min(600, (time - start) / duration * 600)),
      y: 160 - Math.max(0, Math.min(1, sampleValue / maximum)) * 144,
      time,
      value: sampleValue,
    };
  });
}

function axisTime(value: number, duration: number) {
  if (duration === 24 * 60 * 60_000) {
    return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric" });
  }
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function tooltipTime(value: number, duration: number) {
  return new Date(value).toLocaleString([], {
    month: duration === 24 * 60 * 60_000 ? "short" : undefined,
    day: duration === 24 * 60 * 60_000 ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function nearestPoint(points: Point[], x: number) {
  let nearest = points[0];
  for (const point of points) {
    if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
  }
  return nearest;
}

function Chart({
  label,
  points,
  duration,
  end,
  maximum,
  formatValue,
}: {
  label: string;
  points: Point[];
  duration: number;
  end: number;
  maximum: number;
  formatValue: (value: number) => string;
}) {
  const [hovered, setHovered] = useState<Point | null>(null);
  if (points.length === 0) {
    return <div className={styles.emptyChart}>Waiting for the first sample.</div>;
  }
  const line = pathFor(points);
  const area = `${line} L${points.at(-1)?.x.toFixed(2)},160 L${points[0].x.toFixed(2)},160 Z`;
  const start = end - duration;
  const xLabels = [start, start + duration / 2, end];
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 600;
    setHovered(nearestPoint(points, x));
  };
  return (
    <div className={styles.chartFrame}>
      <div className={styles.yAxis} aria-hidden="true">
        <span>{formatValue(maximum)}</span>
        <span>{formatValue(maximum / 2)}</span>
        <span>{formatValue(0)}</span>
      </div>
      <div className={styles.plot} onPointerLeave={() => setHovered(null)}>
        <svg
          className={styles.chart}
          viewBox="0 0 600 176"
          preserveAspectRatio="none"
          role="img"
          onPointerMove={onPointerMove}
        >
          <title>{label} history</title>
          <g className={styles.gridLines}>
            <line x1="0" x2="600" y1="16" y2="16" />
            <line x1="0" x2="600" y1="88" y2="88" />
            <line x1="0" x2="600" y1="160" y2="160" />
          </g>
          <g className={styles.axisLines}>
            <line x1="0" x2="0" y1="16" y2="160" />
            <line x1="0" x2="600" y1="160" y2="160" />
          </g>
          <path className={styles.chartArea} d={area} />
          <path className={styles.chartLine} d={line} />
          {hovered !== null && (
            <>
              <line className={styles.hoverLine} x1={hovered.x} x2={hovered.x} y1="16" y2="160" />
              <circle className={styles.hoverPoint} cx={hovered.x} cy={hovered.y} r="4" />
            </>
          )}
        </svg>
        {hovered !== null && (
          <div
            className={styles.tooltip}
            data-side={hovered.x > 480 ? "left" : "right"}
            style={{ left: `${hovered.x / 6}%`, top: `${hovered.y / 1.76}%` }}
          >
            <strong>{formatValue(hovered.value)}</strong>
            <span>{tooltipTime(hovered.time, duration)}</span>
          </div>
        )}
      </div>
      <div aria-hidden="true" />
      <div className={styles.xAxis} aria-hidden="true">
        {xLabels.map((value) => <span key={value}>{axisTime(value, duration)}</span>)}
      </div>
    </div>
  );
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function PercentPanel({
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
        <div className={styles.metricName}>{icon}<h2>{title}</h2></div>
        <strong>{current === undefined ? "—" : `${current.toFixed(1)}%`}</strong>
      </div>
      <Chart
        label={title}
        points={chartPoints(samples, duration, 100, value, end)}
        duration={duration}
        end={end}
        maximum={100}
        formatValue={(metric) => `${metric.toFixed(0)}%`}
      />
      <div className={styles.summary}>
        <span>Average <strong>{values.length === 0 ? "—" : `${average(values).toFixed(1)}%`}</strong></span>
        <span>Peak <strong>{values.length === 0 ? "—" : `${Math.max(...values).toFixed(1)}%`}</strong></span>
      </div>
    </section>
  );
}

function GraphicsPanel({ samples, duration, end }: { samples: MetricSample[]; duration: number; end: number }) {
  const values = samples.map((sample) => sample.graphics_memory_bytes / MEBIBYTE);
  const current = values.at(-1);
  const maximum = Math.max(256, ...values);
  return (
    <section className={styles.metricPanel}>
      <div className={styles.metricHeader}>
        <div className={styles.metricName}><MonitorUp size={16} /><h2>Graphics</h2></div>
        <strong>{current === undefined ? "—" : `${current.toFixed(0)} MB`}</strong>
      </div>
      <Chart
        label="Graphics memory"
        points={chartPoints(samples, duration, maximum, (sample) => sample.graphics_memory_bytes / MEBIBYTE, end)}
        duration={duration}
        end={end}
        maximum={maximum}
        formatValue={(metric) => `${metric.toFixed(0)} MB`}
      />
      <div className={styles.summary}>
        <span>VM graphics memory</span>
        <span>Peak <strong>{values.length === 0 ? "—" : `${Math.max(...values).toFixed(0)} MB`}</strong></span>
      </div>
    </section>
  );
}

function windowValue(value: string | null): MetricWindow {
  if (value === null) return "live";
  if (WINDOWS.some((window) => window.value === value)) return value as MetricWindow;
  throw new Error(`Unknown metric window: ${value}`);
}

export function ResourceMetrics({ kind, id, running }: { kind: ResourceKind; id: string; running: boolean }) {
  const [search, setSearch] = useSearchParams();
  const window = windowValue(search.get("window"));
  const selectedWindow = WINDOWS.find((item) => item.value === window);
  if (selectedWindow === undefined) throw new Error(`Missing metric window: ${window}`);

  const history = useQuery({
    queryKey: [kind, id, "metrics", window],
    queryFn: () => getResourceMetrics(kind, id, window),
    refetchInterval: running ? 30_000 : false,
  });
  const samples = history.data?.samples ?? [];
  const latest = samples.at(-1);
  const chartEnd = history.dataUpdatedAt;

  return (
    <section className={styles.metricsPage}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}><Activity size={14} />Performance</div>
          <h2>Metrics</h2>
          <p>{running ? "Samples update every 30 seconds." : "This resource is stopped. Historical samples remain available."}</p>
        </div>
        <div className={styles.windowPicker} aria-label="Metric time range">
          {WINDOWS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={window === item.value}
              onClick={() => setSearch({ window: item.value }, { replace: true })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {history.status === "pending" ? (
        <div className={styles.state}>Loading metrics…</div>
      ) : history.error ? (
        <div className={`${styles.state} ${styles.error}`} role="alert">{history.error.message}</div>
      ) : (
        <>
          <div className={styles.metricsGrid}>
            <PercentPanel title="CPU" icon={<Cpu size={16} />} samples={samples} duration={selectedWindow.duration} end={chartEnd} value={(sample) => sample.cpu_percent} />
            <PercentPanel title="Memory" icon={<MemoryStick size={16} />} samples={samples} duration={selectedWindow.duration} end={chartEnd} value={(sample) => sample.memory_percent} />
            <GraphicsPanel samples={samples} duration={selectedWindow.duration} end={chartEnd} />
          </div>
          <footer className={styles.metricsFooter}>
            <span>{samples.length} samples</span>
            <span>{latest === undefined ? "No samples yet" : `Last sample ${new Date(latest.collected_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`}</span>
          </footer>
        </>
      )}
    </section>
  );
}
