import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import CiderLogo from "@/components/CiderLogo";
import { useAuth } from "@/lib/auth";

export default function DashboardChrome({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useAuth();

  if (loading || !me) {
    return (
      <div className="dash-loading">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="dash-shell">
      <header className="dash-header">
        <Link to="/dashboard" className="dash-brand">
          <CiderLogo iconSize={20} />
        </Link>
        <div className="dash-header-right">
          <span className="dash-org" title={me.org.slug}>
            {me.org.name}
          </span>
          <span className="dash-user">{me.user.email}</span>
          <button onClick={logout} className="dash-button-ghost">
            Sign out
          </button>
        </div>
      </header>
      <main className="dash-main">{children}</main>
    </div>
  );
}
