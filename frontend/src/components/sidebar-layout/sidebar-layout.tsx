import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { CiderIcon } from "../cider-icon/cider-icon";
import styles from "./sidebar-layout.module.css";

export function SidebarLayout({
  account,
}: {
  account: ReactNode;
}) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <CiderIcon />
          <span>cider</span>
        </div>
        <nav className={styles.nav}>
          <NavLink
            className={({ isActive }) => isActive ? styles.active : undefined}
            to="/nodes"
          >
            Nodes
          </NavLink>
          <NavLink
            className={({ isActive }) => isActive ? styles.active : undefined}
            to="/sandboxes"
          >
            Sandboxes
          </NavLink>
        </nav>
        <div className={styles.spacer} />
        {account}
      </aside>
      <main className={styles.main}><Outlet /></main>
    </div>
  );
}
