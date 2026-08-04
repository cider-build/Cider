import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import styles from "./sidebar-layout.module.css";

const ICONS = {
  sandboxes: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8.2 12 3 3 8.2v7.6L12 21l9-5.2V8.2z" />
      <path d="M3 8.2l9 5.2 9-5.2" />
      <path d="M12 13.4V21" />
    </svg>
  ),
  servers: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="7" rx="1.6" />
      <rect x="3" y="13" width="18" height="7" rx="1.6" />
      <path d="M7 7.5h.01" />
      <path d="M7 16.5h.01" />
    </svg>
  ),
  nodes: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M2 19.5h20" />
    </svg>
  ),
  snapshots: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  ),
};

function NavItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
      to={to}
    >
      {icon}
      {children}
    </NavLink>
  );
}

export function SidebarLayout({
  account,
}: {
  account: ReactNode;
}) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          cider<em>.</em>
        </div>
        <nav className={styles.nav}>
          <div className={styles.navGroup}>
            <p className={styles.navLabel}>Workloads</p>
            <NavItem to="/sandboxes" icon={ICONS.sandboxes}>Sandboxes</NavItem>
            <NavItem to="/servers" icon={ICONS.servers}>Servers</NavItem>
          </div>
          <div className={styles.navGroup}>
            <p className={styles.navLabel}>Resources</p>
            <NavItem to="/nodes" icon={ICONS.nodes}>Nodes</NavItem>
            <NavItem to="/snapshots" icon={ICONS.snapshots}>Snapshots</NavItem>
          </div>
        </nav>
        <div className={styles.spacer} />
        {account}
      </aside>
      <main className={styles.main}><Outlet /></main>
    </div>
  );
}
