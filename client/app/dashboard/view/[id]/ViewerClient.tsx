"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { APIError, sandboxes, type ConnectInfo } from "@/lib/api";
import VNCViewer from "./VNCViewer";

export default function ViewerClient({ sandboxId }: { sandboxId: string }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setInfo(await sandboxes.connect(sandboxId));
      } catch (err) {
        setError(err instanceof APIError ? err.message : "Failed to resolve sandbox");
      }
    })();
  }, [sandboxId]);

  // The backend embeds the VNC password in the vnc:// URL it returns.
  // Parse it out client-side so the password isn't hardcoded in two places.
  const password = info ? extractVncPassword(info.vnc_url) : "";

  return (
    <div className="viewer-shell">
      <header className="viewer-header">
        <Link href="/dashboard" className="viewer-back" aria-label="Back to dashboard">
          ← Dashboard
        </Link>
        <span className="viewer-id">sandbox {sandboxId.slice(0, 8)}</span>
        {info && <span className="viewer-ip">{info.ip}</span>}
      </header>
      <div className="viewer-body">
        {error ? (
          <p className="viewer-error">{error}</p>
        ) : info ? (
          <VNCViewer sandboxId={sandboxId} vncPassword={password} />
        ) : (
          <p className="viewer-loading">Resolving sandbox…</p>
        )}
      </div>
    </div>
  );
}

function extractVncPassword(vncUrl: string): string {
  // URL("vnc://...") throws in some browsers (non-special scheme). Manual parse.
  const match = vncUrl.match(/^vnc:\/\/[^:]*:([^@]+)@/);
  return match ? decodeURIComponent(match[1]) : "";
}
