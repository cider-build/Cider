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
      <p className={styles.org}>{auth.organization.name}</p>
      <p className={styles.email}>{auth.user.email}</p>
      <button onClick={() => logout.mutate()} disabled={logout.isPending}>Log out</button>
    </section>
  );
}
