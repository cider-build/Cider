import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";
import { Account } from "./components/account/account";
import { AuthForm } from "./components/auth-form/auth-form";
import { NodesPage } from "./components/nodes-page/nodes-page";
import { SandboxesPage } from "./components/sandboxes-page/sandboxes-page";
import { SidebarLayout } from "./components/sidebar-layout/sidebar-layout";
import { me } from "./api";
import type { AuthOut } from "./api";

function ProtectedLayout({ auth }: { auth: AuthOut | null | undefined }) {
  if (!auth) return <Navigate to="/login" replace />;
  return <SidebarLayout account={<Account auth={auth} />} />;
}

export function App() {
  const auth = useQuery({ queryKey: ["me"], queryFn: me });

  if (auth.status === "pending") return <main>Loading...</main>;

  return (
    <Routes>
      <Route
        path="/login"
        element={auth.data ? <Navigate to="/nodes" replace /> : <AuthForm />}
      />
      <Route element={<ProtectedLayout auth={auth.data} />}>
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/sandboxes" element={<SandboxesPage />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={auth.data ? "/nodes" : "/login"} replace />}
      />
    </Routes>
  );
}
