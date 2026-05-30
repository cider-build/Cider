export class APIError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

// Thin fetch wrapper that knows how to talk to the Cider backend with a
// Bearer token. Returns parsed JSON or undefined on 204.
async function request(config, path, { method = "GET", body } = {}) {
  if (!config.apiUrl) throw new Error("Missing apiUrl in config.");
  const headers = { Accept: "application/json" };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const url = `${config.apiUrl.replace(/\/+$/, "")}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${err.message}`);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail =
        typeof j.detail === "string"
          ? j.detail
          : JSON.stringify(j.detail ?? j);
    } catch {
      /* leave detail as statusText */
    }
    throw new APIError(res.status, detail);
  }

  if (res.status === 204) return undefined;
  return await res.json();
}

export function makeClient(config) {
  return {
    me: () => request(config, "/auth/me"),
    logout: () => request(config, "/auth/logout", { method: "POST" }),
    listNodes: () => request(config, "/nodes"),
    listSandboxes: () => request(config, "/sandboxes"),
    createSandbox: (nodeId) =>
      request(config, "/sandboxes", {
        method: "POST",
        body: { node_id: nodeId },
      }),
    connectSandbox: (id) => request(config, `/sandboxes/${id}/connect`),
    deleteSandbox: (id) =>
      request(config, `/sandboxes/${id}`, { method: "DELETE" }),
  };
}
