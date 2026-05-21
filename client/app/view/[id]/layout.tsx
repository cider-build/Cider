import { AuthProvider } from "@/lib/auth";

export const metadata = { title: "Sandbox view — Cider" };

export default function ViewLayout({ children }: { children: React.ReactNode }) {
  // Auth-gated, but no dashboard chrome — the viewer page owns the whole window.
  return <AuthProvider requireAuth>{children}</AuthProvider>;
}
