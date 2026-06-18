import { useQuery } from "@tanstack/react-query";
import { Account } from "./components/account/account";
import { AuthForm } from "./components/auth-form/auth-form";
import { SidebarLayout } from "./components/sidebar-layout/sidebar-layout";
import { me } from "./api";

export function App() {
  const auth = useQuery({ queryKey: ["me"], queryFn: me });

  if (auth.status === "pending") return <main>Loading...</main>;
  if (!auth.data) return <AuthForm />;

  return <SidebarLayout account={<Account auth={auth.data} />} />;
}
