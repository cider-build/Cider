import { useEffect, useRef, useState } from "react";

import { APIError, auth } from "@/lib/api";

interface Props {
  sandboxId: string;
  vncPassword: string;
}

type Status = "connecting" | "connected" | "disconnected" | "error";

export default function VNCViewer({ sandboxId, vncPassword }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string>("");
  const [phase, setPhase] = useState<string>("opening WebSocket…");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let rfb: { disconnect: () => void } | null = null;
    const start = Date.now();
    const elapsedTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    (async () => {
      setPhase("requesting ws ticket…");
      let ticket: string;
      try {
        ({ ticket } = await auth.wsTicket());
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof APIError ? err.message : "Failed to mint WS ticket");
        return;
      }

      setPhase("loading noVNC…");
      const { default: RFB } = await import("@novnc/novnc");
      if (cancelled || !containerRef.current) return;

      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const wsUrl =
        apiUrl.replace(/^http/, "ws") +
        `/sandboxes/${sandboxId}/vnc?ticket=${encodeURIComponent(ticket)}`;

      setPhase("opening WebSocket… (Apple's RFB handshake can take ~10s)");
      const instance = new RFB(containerRef.current, wsUrl, {
        credentials: { password: vncPassword },
        wsProtocols: ["binary"],
      });

      // macOS doesn't render the cursor as part of the framebuffer it sends,
      // and the Cursor pseudo-encoding doesn't always land cleanly through
      // noVNC. showDotCursor guarantees there's *some* visible cursor.
      instance.showDotCursor = true;
      // Lower compression = less server CPU + lower latency; we're on a local
      // socket so saving bytes isn't the bottleneck.
      instance.compressionLevel = 1;
      instance.qualityLevel = 6;
      // CSS-scale the framebuffer to fit the window. We also ask the server to
      // resize but Apple Screen Sharing doesn't honor it, so scaleViewport is
      // what actually delivers "fits on screen".
      instance.scaleViewport = true;
      instance.resizeSession = true;
      instance.background = "#0f172a";

      instance.addEventListener("connect", () => {
        setStatus("connected");
        setPhase("connected");
      });
      instance.addEventListener("disconnect", (e: Event) => {
        const detail = (e as CustomEvent<{ clean: boolean }>).detail;
        setStatus(detail?.clean ? "disconnected" : "error");
        if (!detail?.clean) setError("Connection closed unexpectedly.");
      });
      instance.addEventListener("securityfailure", (e: Event) => {
        const detail = (e as CustomEvent<{ reason: string }>).detail;
        setStatus("error");
        setError(`VNC auth failed: ${detail?.reason || "unknown"}`);
      });
      instance.addEventListener("credentialsrequired", () => {
        instance.sendCredentials({ username: "admin", password: vncPassword });
      });

      rfb = instance;
    })().catch((err: unknown) => {
      if (cancelled) return;
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      clearInterval(elapsedTimer);
      try {
        rfb?.disconnect();
      } catch {
        /* noop */
      }
    };
  }, [sandboxId, vncPassword]);

  return (
    <div className="vnc-shell">
      {status !== "connected" && (
        <div className="vnc-status" data-status={status}>
          <span className={`vnc-dot vnc-dot-${status}`} />
          <span className="vnc-status-label">
            {status === "connecting" && `${phase} (${elapsed}s)`}
            {status === "disconnected" && "Disconnected"}
            {status === "error" && (error || "Error")}
          </span>
        </div>
      )}
      <div ref={containerRef} className="vnc-canvas" />
    </div>
  );
}
