"use client";

import { useState, type FormEvent } from "react";
import { Turnstile, type BoundTurnstileObject } from "react-turnstile";
import { joinWaitlist } from "@/app/actions/waitlist";

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
    if (!email || !token) return;

    setStatus("loading");
    setErrorMsg("");

    const result = await joinWaitlist(email, token);

    if (result.ok) {
      setStatus("success");
    } else {
      setStatus("error");
      setErrorMsg(result.error ?? "Something went wrong.");
      turnstile?.reset();
      setToken(null);
    }
  }

  if (status === "success") {
    return (
      <div className="waitlist-success">
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="8" stroke="#FF8200" strokeWidth="1.5" />
          <path
            d="M6 9l2 2 4-4"
            stroke="#FF8200"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>You&apos;re on the list. We&apos;ll be in touch.</span>
      </div>
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
          disabled={status === "loading" || !token}
          className="waitlist-button"
        >
          {status === "loading" ? "Joining\u2026" : "Get Early Access"}
        </button>
      </form>

      <Turnstile
        sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
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
