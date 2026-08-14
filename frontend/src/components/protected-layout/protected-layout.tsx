import { Navigate } from "react-router";
import type { AuthOut } from "../../api";
import { Account } from "../account/account";
import { SidebarLayout } from "../sidebar-layout/sidebar-layout";

export function ProtectedLayout({
  auth,
}: {
  auth: AuthOut | null | undefined;
}) {
  if (!auth) return <Navigate to="/login" replace />;
  return <SidebarLayout account={<Account auth={auth} />} />;
}
