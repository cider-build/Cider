import type { ReactNode } from "react";
import styles from "./facts.module.css";

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.grid}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
