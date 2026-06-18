const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type AuthOut = {
  user: { id: string; email: string };
  organization: { id: string; name: string };
};

export type LoginInput = { email: string; password: string };
export type SignupInput = LoginInput & { organization_name: string };

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
