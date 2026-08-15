import styles from "./signals.module.css";

export function Signals({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className={styles.signals}>
      {items.map((item) => (
        <div className={styles.signal} key={item.label}>
          <b>{item.value}</b>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
