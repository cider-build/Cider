import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logout as logoutUser } from "../../api";
import type { AuthOut } from "../../api";
import styles from "./account.module.css";

export function Account({ auth }: { auth: AuthOut }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: logoutUser,
    onSuccess: () => queryClient.setQueryData(["me"], null),
  });

  return (
    <section className={styles.account}>
      <p>{auth.user.email}</p>
      <p>{auth.organization.name}</p>
      <button onClick={() => logout.mutate()} disabled={logout.isPending}>Log out</button>
    </section>
  );
}
