import type { MetricSample, MetricWindow } from "../../api";

export type ResourceKind = "server" | "sandbox";
export type Point = { x: number; y: number; time: number; value: number };

export const MEBIBYTE = 1024 ** 2;
export const WINDOWS: Array<{
  value: MetricWindow;
  label: string;
  duration: number;
}> = [
  { value: "live", label: "Live", duration: 10 * 60_000 },
  { value: "1h", label: "1 hour", duration: 60 * 60_000 },
  { value: "24h", label: "24 hours", duration: 24 * 60 * 60_000 },
];

export function pathFor(points: Point[]) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
    )
    .join(" ");
}

export function chartPoints(
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
      x: Math.max(0, Math.min(600, ((time - start) / duration) * 600)),
      y: 160 - Math.max(0, Math.min(1, sampleValue / maximum)) * 144,
      time,
      value: sampleValue,
    };
  });
}

export function axisTime(value: number, duration: number) {
  if (duration === 24 * 60 * 60_000) {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
    });
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function tooltipTime(value: number, duration: number) {
  return new Date(value).toLocaleString([], {
    month: duration === 24 * 60 * 60_000 ? "short" : undefined,
    day: duration === 24 * 60 * 60_000 ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function nearestPoint(points: Point[], x: number) {
  let nearest = points[0];
  for (const point of points) {
    if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
  }
  return nearest;
}

export function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function windowValue(value: string | null): MetricWindow {
  if (value === null) return "live";
  if (WINDOWS.some((window) => window.value === value))
    return value as MetricWindow;
  throw new Error(`Unknown metric window: ${value}`);
}
