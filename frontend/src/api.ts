const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type AuthOut = {
  user: { id: string; email: string };
  organization: { id: string; name: string };
};
export type LoginInput = { email: string; password: string };
export type SignupInput = LoginInput & { organization_name: string };
export type Node = { id: string; name: string; url: string };
export type NodeInput = { name: string; url: string };
export type NodePage = { items: Node[]; page: number; pages: number; total: number };
export type Sandbox = { id: string; node_id: string; status: string; created_at: string; deleted_at: string | null };

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

export async function createNode(body: NodeInput): Promise<Node> {
  const response = await fetch(`${API_URL}/nodes`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function deleteNode(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/nodes/${id}`, { method: "DELETE", credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
}

export async function listSandboxes(): Promise<Sandbox[]> {
  const response = await fetch(`${API_URL}/sandboxes`, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}
