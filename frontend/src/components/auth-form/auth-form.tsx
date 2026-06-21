import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { login, signup } from "../../api";
import type { AuthOut } from "../../api";
import styles from "./auth-form.module.css";

type Mode = "login" | "signup";

export function AuthForm() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data: AuthOut) => queryClient.setQueryData(["me"], data),
  });
  const signupMutation = useMutation({
    mutationFn: signup,
    onSuccess: (data: AuthOut) => queryClient.setQueryData(["me"], data),
  });
  const pending = loginMutation.isPending || signupMutation.isPending;
  const error = loginMutation.error ?? signupMutation.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "signup") signupMutation.mutate({ email, password, organization_name: organizationName });
    else loginMutation.mutate({ email, password });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.tabs}>
        <button type="button" onClick={() => setMode("signup")}>Sign up</button>
        <button type="button" onClick={() => setMode("login")}>Log in</button>
      </div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
      {mode === "signup" && (
        <input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Organization name" />
      )}
      <button disabled={pending}>{mode === "signup" ? "Create account" : "Log in"}</button>
      {error && <p className={styles.error}>{error.message}</p>}
    </form>
  );
}
