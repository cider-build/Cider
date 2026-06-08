import { Command } from "commander";

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
    .option("--node <id>", "Node id. Defaults to the first registered node.")
    .action(async (options) => {
      const api = client();
      let nodeId = options.node;
      if (!nodeId) {
        const nodes = await api.listNodes();
        if (nodes.length === 0) throw new Error("no nodes registered");
        nodeId = nodes[0].id;
      }
      const sandbox = await api.createSandbox(nodeId);
      process.stdout.write(`${sandbox.id}\n`);
    });

  sandboxes
    .command("delete <id>")
    .description("Delete a sandbox")
    .action(async (id) => {
      await client().deleteSandbox(id);
    });

  await program.parseAsync(argv);
}
