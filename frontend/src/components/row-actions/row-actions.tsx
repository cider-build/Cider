import type { ReactNode } from "react";
import styles from "./row-actions.module.css";

export function RowActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
