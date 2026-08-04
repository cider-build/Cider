import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import * as tar from "tar";

import { makeClient } from "./lib/api.js";
import { readConfig } from "./lib/config.js";
import { connect } from "./lib/connect.js";
import { ssh } from "./lib/ssh.js";

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

async function gitFilesIncludingIgnored(dir) {
  const { stdout } = await exec("git", ["-C", dir, "ls-files", "-z", "--cached", "--modified", "--others", "--", "."], { encoding: "buffer", maxBuffer: 1024 * 1024 * 100 });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

async function archivePath(path, includeIgnored = false) {
  const dir = resolve(path);
  const parent = dirname(dir);
  const root = basename(dir);
  const tmp = await mkdtemp(join(tmpdir(), "cider-"));
  const file = join(tmp, "repo.tgz");
  try {
    const files = includeIgnored
      ? await gitFilesIncludingIgnored(dir)
      : await gitFiles(dir);
    await tar.c(
      { cwd: parent, file, gzip: true, portable: true },
      files ? files.map((path) => `${root}/${path}`) : [root],
    );
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

  program
    .command("connect")
    .description("Install the Cider image and connect this Mac to your organization")
    .option("--name <name>", "Node name")
    .option("--image <name:tag>", "Pinned Lume base image")
    .option("--node-command <path>", "Path to the cider-node executable")
    .option("-y, --yes", "Install without prompting")
    .action(connect);

  const nodes = program.command("nodes").description("Manage nodes");

  nodes
    .command("list", { isDefault: true })
    .description("List nodes")
    .action(async () => {
      const rows = await client().listNodes();
      printRows(rows, ["id", "name", "connected"]);
    });

  nodes
    .command("delete <id>")
    .description("Remove a node and revoke its credential")
    .action(async (id) => {
      await client().deleteNode(id);
    });

  program
    .command("open [path]")
    .description("Create a sandbox from a local Git worktree")
    .option("--include-ignored", "Include Git-ignored files in the upload")
    .action(async (path = ".", options = {}) => {
      const archive = await archivePath(path, Boolean(options.includeIgnored));
      try {
        const sandbox = await client().createSandbox(archive.file);
        process.stdout.write(`${sandbox.id}\n`);
      } finally {
        await rm(archive.tmp, { recursive: true, force: true });
      }
    });

  program
    .command("ssh [sandbox]")
    .description("SSH into a sandbox")
    .option("-l, --list", "List available sandboxes")
    .option("-n, --new [node]", "Create a sandbox, optionally on a node, then connect")
    .action(async (sandbox, options) => {
      await ssh(readConfig(), sandbox, options);
    });

  const sandboxes = program.command("sandboxes").description("Manage sandboxes");

  sandboxes
    .command("list", { isDefault: true })
    .description("List sandboxes")
    .action(async () => {
      const rows = await client().listSandboxes();
      printRows(rows, ["id", "node_id", "status", "created_at"]);
    });

  sandboxes
    .command("create")
    .description("Create a blank sandbox VM")
    .action(async () => {
      const sandbox = await client().createSandbox(undefined);
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
    .command("snapshot <id>")
    .description("Stop a sandbox and save a portable snapshot in Cider storage")
    .action(async (id) => {
      const snapshot = await client().snapshotSandbox(id);
      process.stdout.write(`${snapshot.id}\n`);
    });

  sandboxes
    .command("delete <id>")
    .description("Delete a sandbox")
    .action(async (id) => {
      await client().deleteSandbox(id);
    });

  const snapshots = program.command("snapshots").description("Manage snapshots");

  snapshots
    .command("list", { isDefault: true })
    .description("List snapshots")
    .action(async () => {
      const rows = await client().listSnapshots();
      printRows(rows, ["id", "source_sandbox_id", "created_at"]);
    });

  snapshots
    .command("restore <id>")
    .description("Restore a stopped sandbox onto a connected node")
    .option("--node <id>", "Destination node ID")
    .action(async (id, options) => {
      const sandbox = await client().restoreSnapshot(id, options.node);
      process.stdout.write(`${sandbox.id}\n`);
    });

  snapshots
    .command("delete <id>")
    .description("Delete a snapshot")
    .action(async (id) => {
      await client().deleteSnapshot(id);
    });

  await program.parseAsync(argv);
}
