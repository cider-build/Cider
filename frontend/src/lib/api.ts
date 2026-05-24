const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!r.ok) {
    let detail = r.statusText;
    try {
      const body = await r.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? body);
    } catch {
      // fall back to statusText
    }
    throw new APIError(r.status, detail);
  }

  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

// -- Types --

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
}

export interface Me {
  user: User;
  org: Org;
}

export interface Node {
  id: string;
  name: string;
  url: string;
  last_ping_at: string | null;
  last_ping_ok: boolean | null;
}

export const SandboxStatus = {
  pending: "pending",
  running: "running",
  stopped: "stopped",
  deleted: "deleted",
  failed: "failed",
} as const;
export type SandboxStatus = (typeof SandboxStatus)[keyof typeof SandboxStatus];

export interface Sandbox {
  id: string;
  node_id: string;
  status: SandboxStatus;
  created_at: string;
  last_seen_at: string | null;
  stopped_reason: string | null;
  stopped_at: string | null;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface ConnectInfo {
  ip: string;
  vnc_url: string;
  ssh_url: string;
}

// -- Endpoints --

export const auth = {
  signup: (b: { email: string; password: string; name?: string; org_name?: string }) =>
    request<Me>("/auth/signup", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { email: string; password: string }) =>
    request<Me>("/auth/login", { method: "POST", body: JSON.stringify(b) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<Me>("/auth/me"),
  wsTicket: () =>
    request<{ ticket: string }>("/auth/ws-ticket", { method: "POST" }),
};

export const nodes = {
  list: () => request<Node[]>("/nodes"),
  create: (b: { name: string; url: string }) =>
    request<Node>("/nodes", { method: "POST", body: JSON.stringify(b) }),
  remove: (id: string) => request<void>(`/nodes/${id}`, { method: "DELETE" }),
};

export const sandboxes = {
  list: () => request<Sandbox[]>("/sandboxes"),
  create: (node_id: string) =>
    request<Sandbox>("/sandboxes", { method: "POST", body: JSON.stringify({ node_id }) }),
  exec: (id: string, command: string) =>
    request<ExecResult>(`/sandboxes/${id}/exec`, {
      method: "POST",
      body: JSON.stringify({ command }),
    }),
  connect: (id: string) => request<ConnectInfo>(`/sandboxes/${id}/connect`),
  remove: (id: string) => request<void>(`/sandboxes/${id}`, { method: "DELETE" }),
};

export const waitlist = {
  join: (b: { email: string; turnstile_token: string }) =>
    request<{ ok: boolean }>("/waitlist", {
      method: "POST",
      body: JSON.stringify(b),
    }),
};
