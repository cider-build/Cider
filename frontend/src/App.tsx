import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";
import { AuthForm } from "./components/auth-form/auth-form";
import { CreateServerPage } from "./components/create-server-page/create-server-page";
import { NodePage } from "./components/node-page/node-page";
import { NodesPage } from "./components/nodes-page/nodes-page";
import { ProtectedLayout } from "./components/protected-layout/protected-layout";
import { ResourceDetailPage } from "./components/resource-detail-page/resource-detail-page";
import { SandboxesPage } from "./components/sandboxes-page/sandboxes-page";
import { ServersPage } from "./components/servers-page/servers-page";
import { SnapshotsPage } from "./components/snapshots-page/snapshots-page";
import { me } from "./api";

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
        <Route
          path="/sandboxes/:sandboxId"
          element={<ResourceDetailPage kind="sandbox" tab="overview" />}
        />
        <Route
          path="/sandboxes/:sandboxId/metrics"
          element={<ResourceDetailPage kind="sandbox" tab="metrics" />}
        />
        <Route
          path="/sandboxes/:sandboxId/terminal"
          element={<ResourceDetailPage kind="sandbox" tab="terminal" />}
        />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/new" element={<CreateServerPage />} />
        <Route
          path="/servers/:serverId"
          element={<ResourceDetailPage kind="server" tab="overview" />}
        />
        <Route
          path="/servers/:serverId/metrics"
          element={<ResourceDetailPage kind="server" tab="metrics" />}
        />
        <Route
          path="/servers/:serverId/terminal"
          element={<ResourceDetailPage kind="server" tab="terminal" />}
        />
        <Route path="/snapshots" element={<SnapshotsPage />} />
      </Route>
      <Route
        path="*"
        element={<Navigate to={auth.data ? "/nodes" : "/login"} replace />}
      />
    </Routes>
  );
}
