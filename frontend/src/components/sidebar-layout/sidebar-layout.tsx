import type { ReactNode } from "react";
import styles from "./sidebar-layout.module.css";

export function SidebarLayout({ account, children }: { account: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <h1>Cider</h1>
        <div className={styles.spacer} />
        {account}
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
