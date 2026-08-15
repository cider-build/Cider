import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { Icon } from "../ui";
import { NavItem } from "../nav-item/nav-item";
import { ThemeToggle } from "../theme-toggle/theme-toggle";
import styles from "./sidebar-layout.module.css";

export function SidebarLayout({ account }: { account: ReactNode }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <span className={styles.logo}>
          <span className={styles.mark} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <b>
            cider
            <span>.</span>
          </b>
        </span>
        <label className={styles.search}>
          <Icon name="search" />
          <input
            type="text"
            placeholder="Search all"
            aria-label="Search all resources"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <nav className={styles.nav} aria-label="Primary">
          <div>
            <span className={styles.navLabel}>Compute</span>
            <NavItem to="/servers" page="servers">
              Servers
            </NavItem>
            <NavItem to="/sandboxes" page="sandboxes">
              Sandboxes
            </NavItem>
          </div>
          <div>
            <span className={styles.navLabel}>Infrastructure</span>
            <NavItem to="/nodes" page="nodes">
              Nodes
            </NavItem>
            <NavItem to="/snapshots" page="snapshots">
              Snapshots
            </NavItem>
          </div>
        </nav>
        <div className={styles.foot}>
          {account}
          <ThemeToggle />
        </div>
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
