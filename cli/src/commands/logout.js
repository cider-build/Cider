import { readConfig, clearConfig } from "../lib/config.js";
import { makeClient, APIError } from "../lib/api.js";

export async function logoutCommand() {
  const config = await readConfig();
  if (!config.token) {
    process.stdout.write("Not signed in.\n");
    return;
  }

  // Best-effort revoke. If the server's already 401'd us the token's already
  // dead — local state still needs cleaning either way.
  try {
    await makeClient(config).logout();
  } catch (err) {
    if (!(err instanceof APIError) || err.status !== 401) {
      process.stderr.write(`warning: server logout failed: ${err.message}\n`);
    }
  }

  await clearConfig();
  process.stdout.write("Signed out.\n");
}
