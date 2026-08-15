import type { ReactNode } from "react";
import styles from "./detail-pane.module.css";

export function DetailPane({
  children,
  tabbed = false,
}: {
  children: ReactNode;
  tabbed?: boolean;
}) {
  return (
    <div className={styles.pane} data-tabbed={tabbed || undefined}>
      {children}
    </div>
  );
}
