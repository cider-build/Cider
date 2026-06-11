import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import * as tar from "tar";

import { makeClient } from "./lib/api.js";
import { readConfig } from "./lib/config.js";

function printRows(rows, columns) {
  if (rows.length === 0) return;
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
  process.stdout.write(columns.map((column, i) => column.padEnd(widths[i])).join("  ") + "\n");
  for (const row of rows) {
    process.stdout.write(
      columns.map((column, i) => String(row[column] ?? "").padEnd(widths[i])).join("  ") + "\n",
    );
  }
}

function client() {
  return makeClient(readConfig());
}

const exec = promisify(execFile);

async function gitFiles(dir) {
  try {
    const { stdout } = await exec("git", ["-C", dir, "ls-files", "-z", "--cached", "--modified", "--others", "--exclude-standard", "--", "."], { encoding: "buffer", maxBuffer: 1024 * 1024 * 100 });
    return stdout.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

async function archivePath(path) {
  const dir = resolve(path);
  const tmp = await mkdtemp(join(tmpdir(), "cider-"));
  const file = join(tmp, "repo.tgz");
  try {
    await tar.c({ cwd: dir, file, gzip: true, portable: true }, (await gitFiles(dir)) || ["."]);
    return { file, tmp };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

export async function run(argv) {
  const program = new Command();

  program
    .name("cider")
    .description("Barebones CLI for the Cider backend")
    .version("0.1.0");

  const nodes = program.command("nodes").description("Manage nodes");

  nodes
    .command("list", { isDefault: true })
    .description("List nodes")
    .action(async () => {
      const rows = await client().listNodes();
      printRows(rows, ["id", "name", "url"]);
    });

  nodes
    .command("add <name> <url>")
    .description("Register a node")
    .action(async (name, url) => {
      const node = await client().createNode(name, url);
      process.stdout.write(`${node.id}\n`);
    });

  nodes
    .command("delete <id>")
    .description("Delete a node")
    .action(async (id) => {
      await client().deleteNode(id);
    });

  program
    .command("open [path]")
    .description("Create a sandbox and copy a local path into it")
    .action(async (path = ".") => {
      const archive = await archivePath(path);
      try {
        const sandbox = await client().createSandbox(archive.file);
        process.stdout.write(`${sandbox.id}\n`);
      } finally {
        await rm(archive.tmp, { recursive: true, force: true });
      }
    });

  const sandboxes = program.command("sandboxes").description("Manage sandboxes");

  sandboxes
    .command("list", { isDefault: true })
    .description("List sandboxes")
    .action(async () => {
      const rows = await client().listSandboxes();
      printRows(rows, ["id", "node_id", "created_at"]);
    });

  sandboxes
    .command("create")
    .description("Create a sandbox")
    .action(async () => {
      const sandbox = await client().createSandbox();
      process.stdout.write(`${sandbox.id}\n`);
    });

  sandboxes
    .command("exec <id> <command...>")
    .description("Run a command in a sandbox")
    .action(async (id, command) => {
      const result = await client().executeSandbox(id, command.join(" "));
      process.stdout.write(result.output || "");
    });

  sandboxes
    .command("display <id>")
    .description("Open a VNC display session for a sandbox")
    .option("--open", "Open the VNC URL with the OS default handler")
    .action(async (id, options) => {
      const display = await client().openDisplay(id);
      if (options.open) {
        await exec(process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open", process.platform === "win32" ? ["/c", "start", "", display.url] : [display.url]);
      }
      process.stdout.write(`${display.url}\n`);
    });

  sandboxes
    .command("delete <id>")
    .description("Delete a sandbox")
    .action(async (id) => {
      await client().deleteSandbox(id);
    });

  await program.parseAsync(argv);
}
