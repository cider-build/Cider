import type { ReactNode } from "react";
import { CiderIcon } from "../cider-icon/cider-icon";
import styles from "./sidebar-layout.module.css";

export type Page = "nodes" | "sandboxes";

export function SidebarLayout({
  account,
  children,
  page,
  setPage,
}: {
  account: ReactNode;
  children: ReactNode;
  page: Page;
  setPage: (page: Page) => void;
}) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <CiderIcon />
          <span>cider</span>
        </div>
        <nav className={styles.nav}>
          <button data-active={page === "nodes"} onClick={() => setPage("nodes")}>Nodes</button>
          <button data-active={page === "sandboxes"} onClick={() => setPage("sandboxes")}>Sandboxes</button>
        </nav>
        <div className={styles.spacer} />
        {account}
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
