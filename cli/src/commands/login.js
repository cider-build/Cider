import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import open from "open";

import { readConfig, writeConfig } from "../lib/config.js";
import { makeClient } from "../lib/api.js";

const CALLBACK_HTML_OK = `<!doctype html>
<html><head><meta charset="utf-8"><title>Cider CLI — signed in</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #fafafa; margin: 0;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 32px 36px;
          max-width: 420px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
  h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: -0.01em; }
  p  { margin: 0; color: #475569; font-size: 14px; line-height: 1.5; }
  .accent { color: #ff8200; }
</style></head>
<body><div class="card">
  <h1>You're signed in <span class="accent">✓</span></h1>
  <p>You can close this tab and return to your terminal.</p>
</div></body></html>`;

const CALLBACK_HTML_ERR = (msg) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Cider CLI — error</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #fafafa; margin: 0;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #fff; border: 1px solid #fecaca; border-radius: 14px; padding: 32px 36px;
          max-width: 420px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
  h1 { margin: 0 0 8px; font-size: 20px; color: #b91c1c; }
  p  { margin: 0; color: #475569; font-size: 14px; line-height: 1.5; }
</style></head>
<body><div class="card">
  <h1>Could not sign in</h1>
  <p>${msg}</p>
</div></body></html>`;

// Bind a one-shot loopback server on a kernel-assigned port. Returns the bound
// port immediately, plus a promise that resolves once the browser hits
// /callback with a matching `state` token. Five-minute hard timeout.
function bindCallbackServer({ expectedState, timeoutMs = 5 * 60_000 }) {
  let resolveFn;
  let rejectFn;
  const result = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  let settled = false;
  const settle = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }

    const token = url.searchParams.get("token");
    const state = url.searchParams.get("state") ?? "";
    const expiresAt = url.searchParams.get("expires_at");
    const error = url.searchParams.get("error");

    if (error || !token) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(CALLBACK_HTML_ERR(error || "Missing token in callback."));
      settle(rejectFn, new Error(error || "Login callback missing token."));
      setTimeout(() => server.close(), 250);
      return;
    }
    if (state !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        CALLBACK_HTML_ERR(
          "State mismatch — refusing token. Re-run `cider login`."
        )
      );
      settle(rejectFn, new Error("State mismatch on login callback."));
      setTimeout(() => server.close(), 250);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(CALLBACK_HTML_OK);
    // Give the browser a beat to receive the response body before we tear
    // the socket down — otherwise Chrome sometimes shows "connection reset"
    // instead of our success page.
    setTimeout(() => server.close(), 250);
    settle(resolveFn, { token, expiresAt });
  });

  server.on("error", (err) => settle(rejectFn, err));

  const timer = setTimeout(() => {
    settle(rejectFn, new Error("Timed out waiting for browser sign-in."));
    server.close();
  }, timeoutMs);
  server.on("close", () => clearTimeout(timer));

  // Listen on 127.0.0.1 with port 0 → kernel picks an open ephemeral port,
  // so two `cider login` runs can't collide on the same machine.
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : null;
      if (port === null) {
        reject(new Error("Failed to bind loopback listener."));
        return;
      }
      resolve({ port, callback: result });
    });
  });
}

export async function loginCommand(opts) {
  const config = await readConfig();
  const webUrl = (opts.webUrl || config.webUrl).replace(/\/+$/, "");
  const apiUrl = (opts.apiUrl || config.apiUrl).replace(/\/+$/, "");

  // Random `state` guards against another local process hitting our loopback
  // port with a stolen token — we only accept callbacks whose state matches.
  const expectedState = randomBytes(16).toString("hex");
  const { port, callback } = await bindCallbackServer({ expectedState });

  const authUrl = new URL("/cli-auth", webUrl);
  authUrl.searchParams.set("port", String(port));
  authUrl.searchParams.set("state", expectedState);

  process.stdout.write("Opening your browser to sign in...\n");
  process.stdout.write(`If it doesn't open, visit: ${authUrl.toString()}\n\n`);

  try {
    await open(authUrl.toString());
  } catch {
    // Not fatal — the user can paste the URL we just printed.
  }

  const { token, expiresAt } = await callback;

  // Probe /auth/me before persisting so a bad apiUrl surfaces here, not on
  // the user's next command.
  const next = { ...config, apiUrl, webUrl, token };
  const client = makeClient(next);
  let me;
  try {
    me = await client.me();
  } catch (err) {
    throw new Error(
      `Got a token but /auth/me failed: ${err.message}. ` +
        `Check that CIDER_API_URL (${apiUrl}) is correct.`
    );
  }

  await writeConfig({ ...next, expiresAt: expiresAt || null });
  process.stdout.write(
    `Signed in as ${me.user.email} (org: ${me.org.name}).\n`
  );
}
