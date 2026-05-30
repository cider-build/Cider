import { Command } from "commander";

import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { openCommand } from "./commands/open.js";

export async function run(argv) {
  const program = new Command();

  program
    .name("cider")
    .description("Command-line interface for cider.build sandboxes")
    .version("0.1.0");

  program
    .command("login")
    .description("Sign in via your browser and save the token locally")
    .option(
      "--api-url <url>",
      "Override the backend URL (default: $CIDER_API_URL or http://localhost:8000)"
    )
    .option(
      "--web-url <url>",
      "Override the dashboard URL (default: $CIDER_WEB_URL or http://localhost:3000)"
    )
    .action(loginCommand);

  program
    .command("logout")
    .description("Revoke the saved token and clear local credentials")
    .action(logoutCommand);

  program
    .command("whoami")
    .description("Show the currently signed-in user")
    .action(whoamiCommand);

  program
    .command("open [dir]")
    .description(
      "Create or reopen the sandbox linked to a directory and launch Screen Sharing"
    )
    .option("--node <id>", "Use a specific compute node by id")
    .option(
      "--fresh",
      "Ignore any existing .cider/sandbox.json link and create a new sandbox"
    )
    .option("--no-open", "Print connection URLs without launching Screen Sharing")
    .action(openCommand);

  await program.parseAsync(argv);
}
