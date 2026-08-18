import { authClient } from "./auth-client";

const API_URL = import.meta.env.VITE_API_URL;

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
export type NodePage = {
  items: Node[];
  page: number;
  pages: number;
  total: number;
};
export type Sandbox = {
  id: string;
  node_id: string;
  node_name: string;
  storage_used_bytes: number | null;
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
  storage_used_bytes: number | null;
  config: ServerConfig | null;
  created_at: string;
  deleted_at: string | null;
};
export type ResourceKind = "server" | "sandbox";
export type MetricWindow = "live" | "1h" | "24h";
export type MetricSample = {
  cpu_percent: number;
  memory_percent: number;
  graphics_memory_bytes: number;
  collected_at: string;
};
export type MetricHistory = {
  sampling_interval_seconds: number;
  samples: MetricSample[];
};
export type Snapshot = {
  id: string;
  source_sandbox_id: string;
  created_at: string;
  deleted_at: string | null;
  size_bytes: number | null;
};

type RequestOptions = { method?: string; json?: unknown; nullStatus?: number };

async function responseError(response: Response): Promise<Error> {
  const fallback = new Error(`Request failed with status ${response.status}.`);
  const text = await response.text();
  if (text === "") {
    return fallback;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Error(text);
  }
  if (
    typeof body !== "object"
    || body === null
    || !("detail" in body)
    || typeof body.detail !== "string"
  ) {
    return fallback;
  }
  return new Error(body.detail);
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method,
    credentials: "include",
    headers:
      options.json === undefined
        ? undefined
        : { "content-type": "application/json" },
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  if (response.status === options.nullStatus) {
    return null as T;
  }
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

function organizationSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
  if (slug.length === 0) {
    throw new Error("The organization name must contain a letter or number.");
  }
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function me(): Promise<AuthOut | null> {
  const session = await authClient.getSession();
  if (session.error) throw new Error(session.error.message);
  if (session.data === null) return null;

  const organization = await authClient.organization.getFullOrganization();
  if (organization.error) throw new Error(organization.error.message);
  if (organization.data === null) {
    throw new Error("The session has no active organization.");
  }

  return {
    user: { id: session.data.user.id, email: session.data.user.email },
    organization: { id: organization.data.id, name: organization.data.name },
  };
}

export async function signup(input: SignupInput): Promise<AuthOut> {
  const signupResult = await authClient.signUp.email({
    name: input.email,
    email: input.email,
    password: input.password,
  });
  if (signupResult.error) throw new Error(signupResult.error.message);

  const organizationResult = await authClient.organization.create({
    name: input.organization_name,
    slug: organizationSlug(input.organization_name),
    keepCurrentActiveOrganization: false,
  });
  if (organizationResult.error) throw new Error(organizationResult.error.message);

  return {
    user: {
      id: signupResult.data.user.id,
      email: signupResult.data.user.email,
    },
    organization: {
      id: organizationResult.data.id,
      name: organizationResult.data.name,
    },
  };
}

export async function login(input: LoginInput): Promise<AuthOut> {
  const loginResult = await authClient.signIn.email(input);
  if (loginResult.error) throw new Error(loginResult.error.message);

  const organizations = await authClient.organization.list();
  if (organizations.error) throw new Error(organizations.error.message);
  const organization = organizations.data.at(0);
  if (organization === undefined) {
    throw new Error("The account has no organization.");
  }

  const activeOrganization = await authClient.organization.setActive({
    organizationId: organization.id,
  });
  if (activeOrganization.error) throw new Error(activeOrganization.error.message);

  return {
    user: { id: loginResult.data.user.id, email: loginResult.data.user.email },
    organization: { id: organization.id, name: organization.name },
  };
}

export async function logout(): Promise<void> {
  const result = await authClient.signOut();
  if (result.error) throw new Error(result.error.message);
}

export function listNodes({
  page,
  search,
}: {
  page: number;
  search: string;
}): Promise<NodePage> {
  const params = new URLSearchParams({ page: String(page), search });
  return request(`/nodes?${params}`);
}

export async function listAllNodes(): Promise<Node[]> {
  const first = await listNodes({ page: 1, search: "" });
  const rest = await Promise.all(
    Array.from({ length: first.pages - 1 }, (_, index) =>
      listNodes({ page: index + 2, search: "" }),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}

export const getNode = (id: string) => request<Node>(`/nodes/${id}`);
export const deleteNode = (id: string) =>
  request<void>(`/nodes/${id}`, { method: "DELETE" });
export const updateNodeConfiguration = (
  id: string,
  configuration: NodeConfiguration,
) =>
  request<Node>(`/nodes/${id}/configuration`, {
    method: "PATCH",
    json: configuration,
  });

export const listServers = () =>
  request<Server[]>("/servers?include_deleted=true");
export const getServer = (id: string) => request<Server>(`/servers/${id}`);
export const getResourceMetrics = (
  kind: ResourceKind,
  id: string,
  window: MetricWindow,
) => request<MetricHistory>(`/${kind}s/${id}/metrics?window=${window}`);
export const createServer = (body: CreateServerInput) =>
  request<Server>("/servers", { method: "POST", json: body });
export const stopServer = (id: string) =>
  request<Server>(`/servers/${id}/stop`, { method: "POST" });
export const startServer = (id: string) =>
  request<Server>(`/servers/${id}/start`, { method: "POST" });
export const retryServer = (id: string) =>
  request<Server>(`/servers/${id}/retry`, { method: "POST" });
export const deleteServer = (id: string) =>
  request<void>(`/servers/${id}`, { method: "DELETE" });

export const listSnapshots = () =>
  request<Snapshot[]>("/snapshots?include_deleted=true");
export const restoreSnapshot = (id: string) =>
  request<Sandbox>(`/snapshots/${id}/restore`, { method: "POST", json: {} });
export const deleteSnapshot = (id: string) =>
  request<void>(`/snapshots/${id}`, { method: "DELETE" });

export const pauseSandbox = (id: string) =>
  request<Sandbox>(`/sandboxes/${id}/pause`, { method: "POST" });
export const resumeSandbox = (id: string) =>
  request<Sandbox>(`/sandboxes/${id}/resume`, { method: "POST", json: {} });
export const deleteSandbox = (id: string) =>
  request<void>(`/sandboxes/${id}`, { method: "DELETE" });
export const listSandboxes = () => request<Sandbox[]>("/sandboxes");
export const getSandbox = (id: string) => request<Sandbox>(`/sandboxes/${id}`);

export function resourceTerminalUrl(
  kind: ResourceKind,
  id: string,
): string {
  const url = new URL(API_URL);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error(`Unsupported API protocol: ${url.protocol}`);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/terminal/${kind}/${encodeURIComponent(id)}`;
  url.search = "";
  return url.toString();
}
