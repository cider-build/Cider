import styles from "./sparkline.module.css";

export function Sparkline({
  values,
  color = "currentColor",
  fill = false,
}: {
  values: number[];
  color?: string;
  fill?: boolean;
}) {
  const width = 240;
  const height = 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const divisor = Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => {
      const x = (index / divisor) * width;
      const y = height - 5 - ((value - min) / range) * (height - 12);
      return `${x},${y}`;
    })
    .join(" ");
  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className={styles.gridLine} d="M0 16H240M0 32H240M0 48H240" />
      {fill && <polygon points={fillPoints} fill={color} opacity="0.08" />}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
