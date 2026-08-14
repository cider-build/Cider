import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { resourceTerminalUrl } from "../../api";
import styles from "./resource-terminal.module.css";

type ResourceKind = "sandbox" | "server";
type ConnectionState = "connecting" | "connected" | "disconnected";

export function ResourceTerminal({
  kind,
  resourceId,
  available,
}: {
  kind: ResourceKind;
  resourceId: string;
  available: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!available) return;
    const host = hostRef.current;
    if (host === null) return;

    setConnection("connecting");
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        "\"SFMono-Regular\", Consolas, \"Liberation Mono\", Menlo, monospace",
      fontSize: 13,
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: "#171717",
        foreground: "#ededed",
        cursor: "#ff8a1f",
        cursorAccent: "#171717",
        selectionBackground: "#4a4a4a",
        black: "#171717",
        brightBlack: "#737373",
        red: "#ff6b6b",
        brightRed: "#ff8787",
        green: "#8ccf7e",
        brightGreen: "#a6da95",
        yellow: "#e5c07b",
        brightYellow: "#eed49f",
        blue: "#7aa2f7",
        brightBlue: "#8aadf4",
        magenta: "#c099ff",
        brightMagenta: "#c6a0f6",
        cyan: "#79dac8",
        brightCyan: "#8bd5ca",
        white: "#d8d8d8",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;

    const encoder = new TextEncoder();
    let socket: WebSocket | null = null;
    let disposed = false;

    const sendSize = () => {
      fit.fit();
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          term: "xterm-256color",
          resize: { cols: terminal.cols, rows: terminal.rows },
        }),
      );
    };

    const dataInput = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(encoder.encode(data));
    });
    const binaryInput = terminal.onBinary((data) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const bytes = Uint8Array.from(data, (character) =>
        character.charCodeAt(0),
      );
      socket.send(bytes);
    });
    const observer = new ResizeObserver(sendSize);
    observer.observe(host);

    const connectTimer = window.setTimeout(() => {
      if (disposed) return;
      const currentSocket = new WebSocket(
        resourceTerminalUrl(kind, resourceId),
      );
      currentSocket.binaryType = "arraybuffer";
      socket = currentSocket;
      currentSocket.addEventListener("open", () => {
        if (disposed) {
          currentSocket.close(1000, "Terminal closed");
          return;
        }
        sendSize();
        terminal.focus();
      });
      let announced = false;
      currentSocket.addEventListener(
        "message",
        (event: MessageEvent<ArrayBuffer>) => {
          if (typeof event.data === "string") {
            currentSocket.close(1003, "Text output is not supported");
            return;
          }
          /* Avoid React renders for each output frame. */
          if (!announced) {
            announced = true;
            setConnection("connected");
          }
          terminal.write(new Uint8Array(event.data));
        },
      );
      currentSocket.addEventListener("error", () => {
        if (!disposed) setConnection("disconnected");
      });
      currentSocket.addEventListener("close", () => {
        if (!disposed) setConnection("disconnected");
      });
    }, 0);
    const fitFrame = requestAnimationFrame(sendSize);
    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      cancelAnimationFrame(fitFrame);
      observer.disconnect();
      dataInput.dispose();
      binaryInput.dispose();
      if (socket?.readyState === WebSocket.OPEN)
        socket.close(1000, "Terminal closed");
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [available, kind, resourceId, session]);

  if (!available) {
    return (
      <section className={styles.unavailable}>
        <h2>Terminal unavailable</h2>
        <p>Start this resource to open a terminal session.</p>
      </section>
    );
  }

  return (
    <section
      className={styles.shell}
      aria-label="Terminal"
      onClick={() => terminalRef.current?.focus()}
    >
      <div className={styles.terminal} ref={hostRef} />
      {connection !== "connected" && (
        <div className={styles.connection} aria-live="polite">
          {connection === "connecting"
            ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  <span>Connecting…</span>
                </>
              )
            : (
                <>
                  <span>Not connected</span>
                  <button
                    type="button"
                    onClick={() => setSession((value) => value + 1)}
                  >
                    Reconnect
                  </button>
                </>
              )}
        </div>
      )}
    </section>
  );
}
