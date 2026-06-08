async function request(config, path, options = {}) {
  const response = await fetch(`${config.apiUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.status === 204 ? null : response.json();
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
    createSandbox: (nodeId) => request(config, "/sandboxes", {
      method: "POST",
      body: { node_id: nodeId },
    }),
    deleteSandbox: (id) => request(config, `/sandboxes/${id}`, { method: "DELETE" }),
  };
}
