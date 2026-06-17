import { useState, type FormEvent } from "react";
import { Turnstile } from "react-turnstile";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!TURNSTILE_SITE_KEY) return setMessage("Turnstile is not configured.");
    if (!token) return setMessage("Verification is still loading. Please try again.");

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL.replace(/\/+$/, "")}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstile_token: token }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Could not join waitlist.");
      }

      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join waitlist.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="waitlist-hint" style={{ marginTop: 36 }}>
        You&apos;re on the list. We&apos;ll be in touch.
      </p>
    );
  }

  return (
    <>
      <form onSubmit={submit} className="waitlist-form">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          required
          className="waitlist-input"
          aria-label="Email address"
        />
        <button type="submit" disabled={loading} className="waitlist-button">
          {loading ? "Joining…" : "Get Early Access"}
        </button>
      </form>

      {TURNSTILE_SITE_KEY && (
        <Turnstile
          sitekey={TURNSTILE_SITE_KEY}
          onVerify={setToken}
          onExpire={() => setToken(null)}
          theme="light"
          size="invisible"
        />
      )}

      {message && <p className="waitlist-error">{message}</p>}
    </>
  );
}
