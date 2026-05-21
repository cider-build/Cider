"use client";

import Link from "next/link";
import type { ReactNode } from "react";

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
        <Link href="/dashboard" className="dash-brand">
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
