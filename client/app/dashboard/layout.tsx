import { AuthProvider } from "@/lib/auth";
import DashboardChrome from "./DashboardChrome";

export const metadata = { title: "Dashboard — Cider" };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider requireAuth>
      <DashboardChrome>{children}</DashboardChrome>
    </AuthProvider>
  );
}
