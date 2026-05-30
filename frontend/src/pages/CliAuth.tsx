import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import CiderLogo from "@/components/CiderLogo";
import { APIError, auth as authApi } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";

function parsePort(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

function CliAuthInner() {
  const { me, logout } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  const port = parsePort(params.get("port"));
  const state = params.get("state") ?? "";

  async function authorize() {
    if (port === null) {
      setError("Missing or invalid `port`. Re-run `cider login` from your terminal.");
      return;
    }
    setError(null);
    setAuthorizing(true);
    try {
      const { token, expires_at } = await authApi.cliToken();
      const url = new URL(`http://127.0.0.1:${port}/callback`);
      url.searchParams.set("token", token);
      url.searchParams.set("expires_at", expires_at);
      if (state) url.searchParams.set("state", state);
      // Top-level navigation — the CLI's loopback server captures the query
      // string and replies with its own success page, so we don't need a UI
      // state for "done" here.
      window.location.replace(url.toString());
    } catch (err) {
      const message =
        err instanceof APIError ? err.message : "Could not mint CLI token.";
      setError(message);
      setAuthorizing(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="auth-brand" aria-label="Home">
          <CiderLogo iconSize={22} />
        </Link>

        <h1 className="auth-title">Authorize Cider CLI</h1>

        <p className="auth-alt" style={{ textAlign: "left", marginTop: 0 }}>
          Your terminal is asking to sign in as{" "}
          <strong style={{ color: "var(--text-primary, inherit)" }}>
            {me?.user.email}
          </strong>
          . Approve to send a token back to the CLI.
        </p>

        {port === null && (
          <p className="auth-error" style={{ marginTop: 14 }}>
            Missing or invalid `port` query parameter. Re-run{" "}
            <code>cider login</code> from your terminal.
          </p>
        )}

        {error && (
          <p className="auth-error" style={{ marginTop: 14 }}>
            {error}
          </p>
        )}

        <button
          type="button"
          className="auth-submit"
          style={{ marginTop: 22, width: "100%" }}
          disabled={authorizing || port === null}
          onClick={authorize}
        >
          {authorizing ? "Authorizing…" : "Authorize CLI"}
        </button>

        <p className="auth-alt">
          Not you?{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void logout();
            }}
          >
            Sign out
          </a>
        </p>
      </div>
    </main>
  );
}

export default function CliAuth() {
  return (
    <AuthProvider requireAuth>
      <CliAuthInner />
    </AuthProvider>
  );
}
