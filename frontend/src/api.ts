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
export type Sandbox = {
  id: string;
  node_id: string;
  node_name: string;
  status: string;
  created_at: string;
  deleted_at: string | null;
};
export type ServerConfig = {
  image: string;
  software: string[];
  channels: string[];
  env?: Record<string, string>;
  setup?: string | string[] | null;
  start?: string | null;
};
export type CreateServerInput = { name: string; node_id: string | null; config: ServerConfig };
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

type RequestOptions = { method?: string; json?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method,
    credentials: "include",
    headers: options.json === undefined ? undefined : { "content-type": "application/json" },
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  if (!response.ok) {
    const body: { detail: string } = await response.json();
    throw new Error(body.detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export async function me(): Promise<AuthOut | null> {
  const response = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) {
    const body: { detail: string } = await response.json();
    throw new Error(body.detail);
  }
  return response.json();
}

export const signup = (body: SignupInput) => request<AuthOut>("/auth/signup", { method: "POST", json: body });
export const login = (body: LoginInput) => request<AuthOut>("/auth/login", { method: "POST", json: body });
export const logout = () => request<void>("/auth/logout", { method: "POST" });

export function listNodes({ page, search }: { page: number; search: string }): Promise<NodePage> {
  const params = new URLSearchParams({ page: String(page), search });
  return request(`/nodes?${params}`);
}

export async function listAllNodes(): Promise<Node[]> {
  const first = await listNodes({ page: 1, search: "" });
  const rest = await Promise.all(
    Array.from({ length: first.pages - 1 }, (_, index) => listNodes({ page: index + 2, search: "" })),
  );
  return [first, ...rest].flatMap((page) => page.items);
}

export const getNode = (id: string) => request<Node>(`/nodes/${id}`);
export const deleteNode = (id: string) => request<void>(`/nodes/${id}`, { method: "DELETE" });
export const updateNodeConfiguration = (id: string, configuration: NodeConfiguration) =>
  request<Node>(`/nodes/${id}/configuration`, { method: "PATCH", json: configuration });

export const listServers = () => request<Server[]>("/servers?include_deleted=true");
export const createServer = (body: CreateServerInput) => request<Server>("/servers", { method: "POST", json: body });
export const stopServer = (id: string) => request<Server>(`/servers/${id}/stop`, { method: "POST" });
export const startServer = (id: string) => request<Server>(`/servers/${id}/start`, { method: "POST" });
export const retryServer = (id: string) => request<Server>(`/servers/${id}/retry`, { method: "POST" });
export const deleteServer = (id: string) => request<void>(`/servers/${id}`, { method: "DELETE" });

export const listSnapshots = () => request<Snapshot[]>("/snapshots?include_deleted=true");
export const restoreSnapshot = (id: string) =>
  request<Sandbox>(`/snapshots/${id}/restore`, { method: "POST", json: {} });
export const deleteSnapshot = (id: string) => request<void>(`/snapshots/${id}`, { method: "DELETE" });

export const pauseSandbox = (id: string) => request<Sandbox>(`/sandboxes/${id}/pause`, { method: "POST" });
export const resumeSandbox = (id: string) =>
  request<Sandbox>(`/sandboxes/${id}/resume`, { method: "POST", json: {} });
export const deleteSandbox = (id: string) => request<void>(`/sandboxes/${id}`, { method: "DELETE" });
export const listSandboxes = () => request<Sandbox[]>("/sandboxes");
