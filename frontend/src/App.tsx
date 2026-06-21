import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Account } from "./components/account/account";
import { AuthForm } from "./components/auth-form/auth-form";
import { NodesPage } from "./components/nodes-page/nodes-page";
import { SandboxesPage } from "./components/sandboxes-page/sandboxes-page";
import { SidebarLayout } from "./components/sidebar-layout/sidebar-layout";
import type { Page } from "./components/sidebar-layout/sidebar-layout";
import { me } from "./api";

export function App() {
  const auth = useQuery({ queryKey: ["me"], queryFn: me });
  const [page, setPage] = useState<Page>("nodes");

  if (auth.status === "pending") return <main>Loading...</main>;
  if (!auth.data) return <AuthForm />;

  return (
    <SidebarLayout account={<Account auth={auth.data} />} page={page} setPage={setPage}>
      {page === "nodes" ? <NodesPage /> : <SandboxesPage />}
    </SidebarLayout>
  );
}
