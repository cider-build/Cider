"use server";

import pool from "@/lib/db";

interface WaitlistResult {
  ok: boolean;
  error?: string;
}

export async function joinWaitlist(
  email: string,
  turnstileToken: string,
): Promise<WaitlistResult> {
  // ── Validate inputs ───────────────────────────────
  if (!email || !turnstileToken) {
    return { ok: false, error: "Missing required fields." };
  }

  // ── Verify Turnstile token ────────────────────────
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY not set");
    return { ok: false, error: "Server misconfigured." };
  }

  const verification = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: turnstileToken,
      }),
    },
  );

  const outcome = (await verification.json()) as { success: boolean };

  if (!outcome.success) {
    return { ok: false, error: "Bot verification failed. Please try again." };
  }

  // ── Insert into Postgres ──────────────────────────
  try {
    await pool.query(
      `INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [email.toLowerCase().trim()],
    );
    return { ok: true };
  } catch (err) {
    console.error("Waitlist insert error:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
