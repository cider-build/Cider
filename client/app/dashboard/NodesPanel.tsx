"use client";

import { useCallback, useEffect, useState } from "react";

import { APIError, nodes, type Node } from "@/lib/api";

export default function NodesPanel() {
  const [items, setItems] = useState<Node[] | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setItems(await nodes.list());
    } catch (err) {
      if (err instanceof APIError) setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Mirror SandboxesPanel: keep the health-dot fresh so a node going
    // unreachable is visible within seconds, not on the next manual click.
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAdding(true);
    try {
      await nodes.create({ name, url });
      setName("");
      setUrl("");
      await refresh();
    } catch (err) {
      if (err instanceof APIError) setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(id: string) {
    setError("");
    try {
      await nodes.remove(id);
      await refresh();
    } catch (err) {
      if (err instanceof APIError) setError(err.message);
    }
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Nodes</h2>
        <p>Macs registered to this org. Each runs up to two sandbox VMs.</p>
      </header>

      <form onSubmit={onAdd} className="panel-form">
        <input
          type="text"
          placeholder="Name (e.g. mac-mini-1)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="url"
          placeholder="URL (e.g. http://100.64.0.10:8001)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={adding}>
          {adding ? "Adding…" : "Add node"}
        </button>
      </form>

      {error && <p className="panel-error">{error}</p>}

      {items === null ? (
        <p className="panel-empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="panel-empty">No nodes registered yet.</p>
      ) : (
        <ul className="panel-list">
          {items.map((n) => (
            <li key={n.id} className="panel-row">
              <div>
                <p className="panel-row-name">{n.name}</p>
                <p className="panel-row-meta">{n.url}</p>
              </div>
              <div className="panel-row-status">
                <HealthDot ok={n.last_ping_ok} />
                <button
                  className="panel-row-remove"
                  onClick={() => onRemove(n.id)}
                  aria-label={`Remove ${n.name}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HealthDot({ ok }: { ok: boolean | null }) {
  const state = ok === null ? "unknown" : ok ? "up" : "down";
  const label = state === "up" ? "Healthy" : state === "down" ? "Unreachable" : "No ping yet";
  return (
    <span className={`health-dot health-dot-${state}`} title={label} aria-label={label} />
  );
}
