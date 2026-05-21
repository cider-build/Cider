"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import CiderLogo from "@/components/CiderLogo";
import { APIError, auth } from "@/lib/api";

type Mode = "login" | "signup";

interface Props {
  mode: Mode;
}

const COPY: Record<Mode, { title: string; submit: string; alt: { text: string; href: string; label: string } }> = {
  login: {
    title: "Sign in",
    submit: "Sign in",
    alt: { text: "Don't have an account?", href: "/signup", label: "Create one" },
  },
  signup: {
    title: "Create your account",
    submit: "Create account",
    alt: { text: "Already have an account?", href: "/login", label: "Sign in" },
  },
};

export default function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const copy = COPY[mode];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        await auth.signup({ email, password, name: name || undefined });
      } else {
        await auth.login({ email, password });
      }
      router.replace("/dashboard");
    } catch (err) {
      const message =
        err instanceof APIError
          ? err.message
          : "Something went wrong. Please try again.";
      setError(message);
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <Link href="/" className="auth-brand" aria-label="Home">
          <CiderLogo iconSize={22} />
        </Link>

        <h1 className="auth-title">{copy.title}</h1>

        <form onSubmit={onSubmit} className="auth-form">
          {mode === "signup" && (
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
              />
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" disabled={loading} className="auth-submit">
            {loading ? "Working…" : copy.submit}
          </button>
        </form>

        <p className="auth-alt">
          {copy.alt.text}{" "}
          <Link href={copy.alt.href}>{copy.alt.label}</Link>
        </p>
      </div>
    </main>
  );
}
