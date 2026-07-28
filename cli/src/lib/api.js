import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(config, path, options = {}) {
  const headers = {};
  if (options.body) headers["Content-Type"] = "application/json";
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(`${config.apiUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : options.form,
  });

  if (!response.ok) throw new ApiError(response.status, await response.text());
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
    me: () => request(config, "/auth/me"),
    cliLogin: (email, password) => request(config, "/auth/cli/login", {
      method: "POST",
      body: { email, password },
    }),
    enrollNode: (name) => request(config, "/nodes/enrollments", {
      method: "POST",
      body: { name },
    }),
    listNodes: async () => {
      const nodes = [];
      let page = 1;
      while (true) {
        const result = await request(config, `/nodes?page=${page}`);
        nodes.push(...result.items);
        if (page >= result.pages) return nodes;
        page += 1;
      }
    },
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
    deleteNode: (id) => request(config, `/nodes/${id}`, { method: "DELETE" }),
    snapshotSandbox: (id) => request(config, `/sandboxes/${id}/snapshots`, { method: "POST" }),
    restoreSnapshot: (id) => request(config, `/snapshots/${id}/sandboxes`, { method: "POST" }),
    deleteSnapshot: (id) => request(config, `/snapshots/${id}`, { method: "DELETE" }),
    deleteSandbox: (id) => request(config, `/sandboxes/${id}`, { method: "DELETE" }),
  };
}
