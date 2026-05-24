"use client";

import Link from "next/link";
import { useState } from "react";

import { APIError, SandboxStatus, sandboxes, type ExecResult, type Sandbox } from "@/lib/api";

interface HistoryEntry {
  id: number;
  command: string;
  result?: ExecResult;
  error?: string;
  pending?: boolean;
}

interface Props {
  sandbox: Sandbox;
  nodeName: string;
  onRemove: (id: string) => Promise<void>;
}

let nextId = 1;

export default function SandboxRow({ sandbox, nodeName, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [running, setRunning] = useState(false);

  const canExec = sandbox.status === SandboxStatus.running;

  async function onExec(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim() || running) return;

    const entry: HistoryEntry = { id: nextId++, command, pending: true };
    setHistory((h) => [...h, entry]);
    setCommand("");
    setRunning(true);

    try {
      const result = await sandboxes.exec(sandbox.id, entry.command);
      setHistory((h) =>
        h.map((x) => (x.id === entry.id ? { ...x, result, pending: false } : x)),
      );
    } catch (err) {
      const message = err instanceof APIError ? err.message : "Exec failed";
      setHistory((h) =>
        h.map((x) => (x.id === entry.id ? { ...x, error: message, pending: false } : x)),
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <li className="panel-row-block">
      <div className="panel-row">
        <button
          className="sandbox-toggle"
          onClick={() => canExec && setOpen((v) => !v)}
          aria-expanded={open}
          disabled={!canExec}
          title={canExec ? "Click to run commands" : `Sandbox is ${sandbox.status}`}
        >
          <span className={`sandbox-caret ${open ? "is-open" : ""}`} aria-hidden>
            ▶
          </span>
          <span>
            <span className="panel-row-name">{sandbox.id.slice(0, 8)}</span>
            <span className="panel-row-meta">
              node {nodeName}
              {sandbox.status === SandboxStatus.stopped && sandbox.stopped_reason
                ? ` · ${sandbox.stopped_reason}`
                : null}
            </span>
          </span>
        </button>
        <div className="panel-row-status">
          <span className={`status-pill status-${sandbox.status}`}>{sandbox.status}</span>
          {canExec && (
            <Link
              className="panel-row-connect"
              href={`/view/${sandbox.id}`}
              aria-label={`View ${sandbox.id} screen`}
              title="Open screen in browser (full window)"
            >
              View
            </Link>
          )}
          <button
            className="panel-row-remove"
            onClick={() => onRemove(sandbox.id)}
            aria-label={`Delete sandbox ${sandbox.id}`}
          >
            Delete
          </button>
        </div>
      </div>

      {open && canExec && (
        <div className="sandbox-exec">
          {history.length > 0 && (
            <div className="exec-history">
              {history.map((h) => (
                <div key={h.id} className="exec-entry">
                  <div className="exec-cmd">
                    <span className="exec-prompt">$</span> {h.command}
                  </div>
                  {h.pending && <div className="exec-output exec-pending">Running…</div>}
                  {h.error && <div className="exec-output exec-error">{h.error}</div>}
                  {h.result && (
                    <>
                      {h.result.stdout && (
                        <pre className="exec-output">{h.result.stdout}</pre>
                      )}
                      {h.result.stderr && (
                        <pre className="exec-output exec-stderr">{h.result.stderr}</pre>
                      )}
                      <div
                        className={`exec-exit ${h.result.exit_code === 0 ? "ok" : "fail"}`}
                      >
                        exit {h.result.exit_code}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <form onSubmit={onExec} className="exec-form">
            <span className="exec-prompt">$</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="echo hello"
              autoFocus
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={running}
            />
            <button type="submit" disabled={running || !command.trim()}>
              {running ? "…" : "Run"}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
