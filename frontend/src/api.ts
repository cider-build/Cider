const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type AuthOut = {
  user: { id: string; email: string };
  organization: { id: string; name: string };
};
export type LoginInput = { email: string; password: string };
export type SignupInput = LoginInput & { organization_name: string };
export type NodeMetadata = {
  hardware_model: string;
  chip: string;
  macos_version: string;
  cpu_count: number;
  memory_bytes: number;
  storage_total_bytes: number;
  storage_available_bytes: number;
};
export type NodeConfiguration = {
  vm_count: 1 | 2;
  sandbox_cpu_count: number;
  sandbox_memory_bytes: number;
  sandbox_storage_bytes: number;
};
export type Node = {
  id: string;
  name: string;
  connected: boolean;
  metadata: NodeMetadata | null;
  configuration: NodeConfiguration | null;
};
export type NodePage = { items: Node[]; page: number; pages: number; total: number };
export type Sandbox = { id: string; node_id: string; node_name: string; status: string; created_at: string; deleted_at: string | null };
export type ServerConfig = {
  image: string;
  software: string[];
  channels: string[];
  env?: Record<string, string>;
  setup?: string | string[] | null;
  start?: string | null;
};
export type CreateServerInput = {
  name: string;
  node_id: string | null;
  config: ServerConfig;
};
export type Server = {
  id: string;
  name: string;
  node_id: string;
  node_name: string;
  status: string;
  status_detail: string | null;
  config: ServerConfig | null;
  created_at: string;
  deleted_at: string | null;
};
export type Snapshot = {
  id: string;
  source_sandbox_id: string;
  created_at: string;
  deleted_at: string | null;
  size_bytes: number | null;
};

export async function me(): Promise<AuthOut | null> {
  const response = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function signup(body: SignupInput): Promise<AuthOut> {
  const response = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function login(body: LoginInput): Promise<AuthOut> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
}

export async function listNodes({ page, search }: { page: number; search: string }): Promise<NodePage> {
  const params = new URLSearchParams({ page: String(page), search });
  const response = await fetch(`${API_URL}/nodes?${params}`, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function getNode(id: string): Promise<Node> {
  const response = await fetch(`${API_URL}/nodes/${id}`, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function deleteNode(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/nodes/${id}`, { method: "DELETE", credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
}

export async function updateNodeConfiguration(id: string, configuration: NodeConfiguration): Promise<Node> {
  const response = await fetch(`${API_URL}/nodes/${id}/configuration`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(configuration),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(typeof body.detail === "string" ? body.detail : "Could not save node configuration");
  }
  return await response.json();
}

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text();
  try {
    const detail = JSON.parse(text).detail;
    throw new Error(typeof detail === "string" ? detail : text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(text);
    throw error;
  }
}

/** Includes tombstoned rows — deletion history feeds the rail sparkline. */
export async function listServers(): Promise<Server[]> {
  const response = await requireOk(await fetch(`${API_URL}/servers?include_deleted=true`, { credentials: "include" }));
  return await response.json();
}

export async function createServer(body: CreateServerInput): Promise<Server> {
  const response = await requireOk(await fetch(`${API_URL}/servers`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return await response.json();
}

export async function stopServer(id: string): Promise<Server> {
  const response = await requireOk(await fetch(`${API_URL}/servers/${id}/stop`, { method: "POST", credentials: "include" }));
  return await response.json();
}

export async function startServer(id: string): Promise<Server> {
  const response = await requireOk(await fetch(`${API_URL}/servers/${id}/start`, { method: "POST", credentials: "include" }));
  return await response.json();
}

export async function retryServer(id: string): Promise<Server> {
  const response = await requireOk(await fetch(`${API_URL}/servers/${id}/retry`, { method: "POST", credentials: "include" }));
  return await response.json();
}

export async function deleteServer(id: string): Promise<void> {
  await requireOk(await fetch(`${API_URL}/servers/${id}`, { method: "DELETE", credentials: "include" }));
}

/** Includes tombstoned rows — deletion history feeds the rail sparkline. */
export async function listSnapshots(): Promise<Snapshot[]> {
  const response = await requireOk(await fetch(`${API_URL}/snapshots?include_deleted=true`, { credentials: "include" }));
  return await response.json();
}

export async function restoreSnapshot(id: string): Promise<Sandbox> {
  const response = await requireOk(await fetch(`${API_URL}/snapshots/${id}/restore`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
  return await response.json();
}

export async function deleteSnapshot(id: string): Promise<void> {
  await requireOk(await fetch(`${API_URL}/snapshots/${id}`, { method: "DELETE", credentials: "include" }));
}

export async function pauseSandbox(id: string): Promise<Sandbox> {
  const response = await requireOk(await fetch(`${API_URL}/sandboxes/${id}/pause`, { method: "POST", credentials: "include" }));
  return await response.json();
}

export async function resumeSandbox(id: string): Promise<Sandbox> {
  const response = await requireOk(await fetch(`${API_URL}/sandboxes/${id}/resume`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
  return await response.json();
}

export async function deleteSandbox(id: string): Promise<void> {
  await requireOk(await fetch(`${API_URL}/sandboxes/${id}`, { method: "DELETE", credentials: "include" }));
}

export async function listSandboxes(): Promise<Sandbox[]> {
  const response = await fetch(`${API_URL}/sandboxes`, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}
