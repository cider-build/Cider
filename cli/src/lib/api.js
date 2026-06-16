import { readFile } from "node:fs/promises";
import { basename } from "node:path";

async function request(config, path, options = {}) {
  const response = await fetch(`${config.apiUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : options.form,
  });

  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? null : response.json();
}

async function sandboxForm(archivePath) {
  const form = new FormData();
  if (archivePath) {
    form.set("archive", new Blob([await readFile(archivePath)]), basename(archivePath));
  }
  return form;
}

export function makeClient(config) {
  return {
    listNodes: () => request(config, "/nodes"),
    createNode: (name, url) => request(config, "/nodes", {
      method: "POST",
      body: { name, url },
    }),
    deleteNode: (id) => request(config, `/nodes/${id}`, { method: "DELETE" }),

    listSandboxes: () => request(config, "/sandboxes"),
    listSnapshots: () => request(config, "/snapshots"),
    createSandbox: async (archivePath) => request(config, "/sandboxes", {
      method: "POST",
      form: await sandboxForm(archivePath),
    }),
    executeSandbox: (id, command) => request(config, `/sandboxes/${id}/execute`, {
      method: "POST",
      body: { command },
    }),
    openDisplay: (id) => request(config, `/sandboxes/${id}/display`, { method: "POST" }),
    snapshotSandbox: (id) => request(config, `/sandboxes/${id}/snapshots`, { method: "POST" }),
    restoreSnapshot: (id) => request(config, `/snapshots/${id}/sandboxes`, { method: "POST" }),
    deleteSnapshot: (id) => request(config, `/snapshots/${id}`, { method: "DELETE" }),
    deleteSandbox: (id) => request(config, `/sandboxes/${id}`, { method: "DELETE" }),
  };
}
