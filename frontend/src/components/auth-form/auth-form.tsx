import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { login, signup } from "../../api";
import type { AuthOut } from "../../api";
import { Button } from "../ui/ui";
import styles from "./auth-form.module.css";

type Mode = "login" | "signup";

export function AuthForm() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("login");
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
    if (mode === "signup")
      signupMutation.mutate({
        email,
        password,
        organization_name: organizationName,
      });
    else loginMutation.mutate({ email, password });
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <span className={styles.logo}>
          <span className={styles.mark} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <b>
            cider<span>.</span>
          </b>
        </span>

        <nav className={styles.tabs} aria-label="Account">
          <button
            type="button"
            aria-current={mode === "login" ? "page" : undefined}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            aria-current={mode === "signup" ? "page" : undefined}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </nav>

        <label className={styles.field}>
          <span>Email</span>
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            spellCheck={false}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
          />
        </label>
        {mode === "signup" && (
          <label className={styles.field}>
            <span>Organization</span>
            <input
              className={styles.input}
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              autoComplete="organization"
              required
            />
          </label>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error.message}
          </p>
        )}
        <Button kind="primary" block type="submit" disabled={pending}>
          {pending
            ? "Working"
            : mode === "signup"
              ? "Create account"
              : "Log in"}
        </Button>
      </form>
    </main>
  );
}
