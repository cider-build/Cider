import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  axisTime,
  nearestPoint,
  pathFor,
  tooltipTime,
} from "../resource-metrics/resource-metrics.utils";
import type { Point } from "../resource-metrics/resource-metrics.utils";
import styles from "./metric-chart.module.css";

export function MetricChart({
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
    return (
      <div className={styles.emptyChart}>Waiting for the first sample.</div>
    );
  }
  const line = pathFor(points);
  const area = `${line} L${points[points.length - 1].x.toFixed(2)},160 L${points[0].x.toFixed(2)},160 Z`;
  const start = end - duration;
  const xLabels = [start, start + duration / 2, end];
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 600;
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
          <title>
            {label}
            {" "}
            history
          </title>
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
              <line
                className={styles.hoverLine}
                x1={hovered.x}
                x2={hovered.x}
                y1="16"
                y2="160"
              />
              <circle
                className={styles.hoverPoint}
                cx={hovered.x}
                cy={hovered.y}
                r="4"
              />
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
        {xLabels.map((value) => (
          <span key={value}>{axisTime(value, duration)}</span>
        ))}
      </div>
    </div>
  );
}
