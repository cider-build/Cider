import { readConfig } from "../lib/config.js";
import { makeClient, APIError } from "../lib/api.js";

export async function whoamiCommand() {
  const config = await readConfig();
  if (!config.token) {
    process.stdout.write("Not signed in. Run `cider login`.\n");
    process.exit(1);
  }

  try {
    const me = await makeClient(config).me();
    process.stdout.write(`${me.user.email}\n`);
    process.stdout.write(`  org:    ${me.org.name} (${me.org.slug})\n`);
    process.stdout.write(`  api:    ${config.apiUrl}\n`);
  } catch (err) {
    if (err instanceof APIError && err.status === 401) {
      process.stderr.write(
        "Session expired. Run `cider login` to sign in again.\n"
      );
      process.exit(1);
    }
    throw err;
  }
}
