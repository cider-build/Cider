import { Sparkline } from "../ui";
import styles from "./signals.module.css";

export function Signals({
  items,
}: {
  items: Array<{ label: string; value: string; series?: number[] }>;
}) {
  return (
    <div className={styles.signals}>
      {items.map((item) => (
        <div className={styles.signal} key={item.label}>
          <b>{item.value}</b>
          <span>{item.label}</span>
          {item.series != null && item.series.length > 0 && (
            <div className={styles.chart}>
              <Sparkline values={item.series} color="var(--color-accent)" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
