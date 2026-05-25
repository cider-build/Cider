import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { APIError, sandboxes, type ConnectInfo } from "@/lib/api";
import VNCViewer from "./VNCViewer";

export default function Viewer() {
  const { id } = useParams<{ id: string }>();
  const sandboxId = id;
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sandboxId) {
      setError("Missing sandbox id.");
      return;
    }
    (async () => {
      try {
        setInfo(await sandboxes.connect(sandboxId));
      } catch (err) {
        setError(err instanceof APIError ? err.message : "Failed to resolve sandbox");
      }
    })();
  }, [sandboxId]);

  const password = info ? extractVncPassword(info.vnc_url) : "";

  return (
    <div className="viewer-shell">
      <Link
        to="/dashboard"
        className="viewer-back-floating"
        aria-label="Back to dashboard"
        title="Back to dashboard"
      >
        ←
      </Link>
      {error ? (
        <p className="viewer-error">{error}</p>
      ) : info && sandboxId ? (
        <VNCViewer sandboxId={sandboxId} vncPassword={password} />
      ) : (
        <p className="viewer-loading">Resolving sandbox…</p>
      )}
    </div>
  );
}

function extractVncPassword(vncUrl: string): string {
  // URL("vnc://...") throws in some browsers (non-special scheme). Manual parse.
  const match = vncUrl.match(/^vnc:\/\/[^:]*:([^@]+)@/);
  return match ? decodeURIComponent(match[1]) : "";
}
