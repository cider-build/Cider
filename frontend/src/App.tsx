import { useQuery } from "@tanstack/react-query";
import { Account } from "./components/account/account";
import { AuthForm } from "./components/auth-form/auth-form";
import { me } from "./api";

export function App() {
  const auth = useQuery({ queryKey: ["me"], queryFn: me });

  return (
    <main>
      <h1>Cider</h1>
      {auth.status === "pending" ? "Loading..." : auth.data ? <Account auth={auth.data} /> : <AuthForm />}
    </main>
  );
}
