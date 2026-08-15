import type { ReactNode } from "react";
import styles from "./toolbar.module.css";

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>;
}
