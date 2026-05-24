import { useState, type FormEvent } from "react";
import { Turnstile, type BoundTurnstileObject } from "react-turnstile";

import { APIError, waitlist } from "@/lib/api";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<BoundTurnstileObject | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    setErrorMsg("");

    // If Turnstile hasn't resolved yet, wait for it (up to 5s)
    let resolvedToken = token;
    if (!resolvedToken) {
      resolvedToken = await new Promise<string | null>((resolve) => {
        const start = Date.now();
        const interval = setInterval(() => {
          if (token) {
            clearInterval(interval);
            resolve(token);
          } else if (Date.now() - start > 5000) {
            clearInterval(interval);
            resolve(null);
          }
        }, 100);
      });
    }

    if (!resolvedToken) {
      setStatus("error");
      setErrorMsg("Verification timed out. Please refresh and try again.");
      return;
    }

    try {
      await waitlist.join({ email, turnstile_token: resolvedToken });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof APIError ? err.message : "Something went wrong.",
      );
      turnstile?.reset();
      setToken(null);
    }
  }

  if (status === "success") {
    return (
      <p className="waitlist-hint" style={{ marginTop: 36 }}>
        You&apos;re on the list. We&apos;ll be in touch.
      </p>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="waitlist-form">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          className="waitlist-input"
          aria-label="Email address"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="waitlist-button"
        >
          {status === "loading" ? "Joining…" : "Get Early Access"}
        </button>
      </form>

      <Turnstile
        sitekey={import.meta.env.VITE_TURNSTILE_SITE_KEY!}
        onVerify={(t: string) => setToken(t)}
        onExpire={() => setToken(null)}
        onLoad={(_widgetId: string, bound: BoundTurnstileObject) => setTurnstile(bound)}
        theme="light"
        size="invisible"
      />

      {status === "error" && (
        <p className="waitlist-error">{errorMsg}</p>
      )}
    </>
  );
}
