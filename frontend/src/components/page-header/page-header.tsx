import type { ReactNode } from "react";
import styles from "./page-header.module.css";

export function PageHeader({
  title,
  lede,
  action,
  actions,
}: {
  title: string;
  lede?: ReactNode;
  action?: ReactNode;
  /** Back-compat alias for `action`. */
  actions?: ReactNode;
}) {
  return (
    <header className={styles.phead}>
      <div>
        <h1>{title}</h1>
        {lede != null && <p>{lede}</p>}
      </div>
      <div className={styles.grow} />
      {action ?? actions}
    </header>
  );
}
