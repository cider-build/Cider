import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { Icon } from "../ui/ui";
import { useTheme } from "../../theme";
import styles from "./sidebar-layout.module.css";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={styles.theme}
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {dark ? (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}

function NavItem({
  to,
  page,
  children,
}: {
  to: string;
  page: "servers" | "sandboxes" | "nodes" | "snapshots";
  children: ReactNode;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        isActive ? `${styles.link} ${styles.active}` : styles.link
      }
      to={to}
    >
      <Icon name={page} />
      {children}
    </NavLink>
  );
}

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
            cider<span>.</span>
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
