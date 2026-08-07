import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";
import { Account } from "./components/account/account";
import { AuthForm } from "./components/auth-form/auth-form";
import { CreateServerPage } from "./components/create-server-page/create-server-page";
import { NodePage } from "./components/node-page/node-page";
import { NodesPage } from "./components/nodes-page/nodes-page";
import { SandboxDetailPage, ServerDetailPage } from "./components/resource-detail-page/resource-detail-page";
import { SandboxesPage } from "./components/sandboxes-page/sandboxes-page";
import { ServersPage } from "./components/servers-page/servers-page";
import { SidebarLayout } from "./components/sidebar-layout/sidebar-layout";
import { SnapshotsPage } from "./components/snapshots-page/snapshots-page";
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
        <Route path="/nodes/:nodeId" element={<NodePage />} />
        <Route path="/sandboxes" element={<SandboxesPage />} />
        <Route path="/sandboxes/:sandboxId" element={<SandboxDetailPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/new" element={<CreateServerPage />} />
        <Route path="/servers/:serverId" element={<ServerDetailPage />} />
        <Route path="/snapshots" element={<SnapshotsPage />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={auth.data ? "/nodes" : "/login"} replace />}
      />
    </Routes>
  );
}
