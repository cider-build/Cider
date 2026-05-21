"use client";

import { useCallback, useEffect, useState } from "react";

import { APIError, nodes, sandboxes, type Node, type Sandbox } from "@/lib/api";
import SandboxRow from "./SandboxRow";

export default function SandboxesPanel() {
  const [items, setItems] = useState<Sandbox[] | null>(null);
  const [nodeList, setNodeList] = useState<Node[]>([]);
  const [selectedNode, setSelectedNode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [sbs, ns] = await Promise.all([sandboxes.list(), nodes.list()]);
      setItems(sbs);
      setNodeList(ns);
      if (!selectedNode && ns.length > 0) setSelectedNode(ns[0].id);
    } catch (err) {
      if (err instanceof APIError) setError(err.message);
    }
  }, [selectedNode]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedNode) return;
    setError("");
    setCreating(true);
    try {
      await sandboxes.create(selectedNode);
    } catch (err) {
      if (err instanceof APIError) setError(err.message);
    } finally {
      setCreating(false);
      await refresh();
    }
  }

  async function onRemove(id: string) {
    setError("");
    try {
      await sandboxes.remove(id);
    } catch (err) {
      if (err instanceof APIError) setError(err.message);
    } finally {
      // Refresh either way so the UI never gets stuck out of sync with the
      // backend after a transient error.
      await refresh();
    }
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Sandboxes</h2>
        <p>macOS sandboxes scheduled across your nodes.</p>
      </header>

      <form onSubmit={onCreate} className="panel-form">
        <select
          value={selectedNode}
          onChange={(e) => setSelectedNode(e.target.value)}
          disabled={nodeList.length === 0}
        >
          {nodeList.length === 0 ? (
            <option value="">Register a node first</option>
          ) : (
            nodeList.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))
          )}
        </select>
        <button type="submit" disabled={creating || !selectedNode}>
          {creating ? "Creating…" : "Create sandbox"}
        </button>
      </form>

      {error && <p className="panel-error">{error}</p>}

      {items === null ? (
        <p className="panel-empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="panel-empty">No sandboxes yet.</p>
      ) : (
        <ul className="panel-list">
          {items.map((s) => (
            <SandboxRow
              key={s.id}
              sandbox={s}
              nodeName={
                nodeList.find((n) => n.id === s.node_id)?.name ?? s.node_id.slice(0, 8)
              }
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
