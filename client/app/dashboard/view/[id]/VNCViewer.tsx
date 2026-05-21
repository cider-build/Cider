"use client";

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

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const wsUrl =
        apiUrl.replace(/^http/, "ws") +
        `/sandboxes/${sandboxId}/vnc?ticket=${encodeURIComponent(ticket)}`;

      setPhase("opening WebSocket… (Apple's RFB handshake can take ~10s)");
      const instance = new RFB(containerRef.current, wsUrl, {
        credentials: { password: vncPassword },
        wsProtocols: ["binary"],
      });

      instance.viewOnly = false;
      instance.scaleViewport = true;
      instance.resizeSession = false;
      instance.background = "#0f172a";

      const log = (label: string) => (e: Event) => {
        const detail = (e as CustomEvent).detail;
        // eslint-disable-next-line no-console
        console.log(`[vnc] ${label}`, detail ?? "");
      };

      // Surface every noVNC event we know about so we can see where it stalls.
      [
        "connect",
        "disconnect",
        "credentialsrequired",
        "securityfailure",
        "serververification",
        "capabilities",
        "desktopname",
        "clipboard",
        "bell",
      ].forEach((name) => instance.addEventListener(name, log(name)));

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
      instance.addEventListener("credentialsrequired", (e: Event) => {
        const types = (e as CustomEvent<{ types?: string[] }>).detail?.types;
        setPhase(`sending credentials (${types?.join(",") ?? "password"})`);
        // Apple's Screen Sharing offers ARD auth (type 30) which needs both
        // username + password; legacy VNC (type 2) needs just password. Provide
        // both — noVNC ignores extras for whatever type it ended up picking.
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
      <div className="vnc-status" data-status={status}>
        <span className={`vnc-dot vnc-dot-${status}`} />
        <span className="vnc-status-label">
          {status === "connecting" && `${phase} (${elapsed}s)`}
          {status === "connected" && "Connected"}
          {status === "disconnected" && "Disconnected"}
          {status === "error" && (error || "Error")}
        </span>
      </div>
      <div ref={containerRef} className="vnc-canvas" />
    </div>
  );
}
