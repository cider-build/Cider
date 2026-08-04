import WebSocket from "ws";

import { makeClient } from "./api.js";


function printTargets(targets) {
  if (targets.length === 0) {
    process.stdout.write("No available sandboxes.\n");
    return;
  }
  const columns = ["sandbox_id", "node_name", "status"];
  const widths = columns.map((column) =>
    Math.max(column.length, ...targets.map((target) => String(target[column]).length)),
  );
  process.stdout.write(
    `${columns.map((column, index) => column.padEnd(widths[index])).join("  ")}\n`,
  );
  for (const target of targets) {
    process.stdout.write(
      `${columns.map((column, index) =>
        String(target[column]).padEnd(widths[index])
      ).join("  ")}\n`,
    );
  }
}


function websocketUrl(apiUrl, sandboxId) {
  const url = new URL(apiUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error(`unsupported Cider API protocol: ${url.protocol}`);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ssh/${sandboxId}`;
  url.search = "";
  return url.toString();
}


function runSsh(config, target) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl(config.apiUrl, target.sandbox_id), {
      headers: { Authorization: `Bearer ${config.token}` },
      handshakeTimeout: 30_000,
    });
    let settled = false;
    let raw = false;

    const onData = (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    };
    const onEnd = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(Buffer.from([4]));
    };
    const onSignal = () => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "CLI stopped");
      else socket.terminate();
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.stdin.pause();
      if (raw) process.stdin.setRawMode(false);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    socket.on("open", () => {
      process.stderr.write(
        `Connecting to ${target.sandbox_id} on ${target.node_name}\n`,
      );
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        raw = true;
      }
      process.stdin.on("data", onData);
      process.stdin.on("end", onEnd);
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      process.stdin.resume();
    });
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        socket.close(1003, "SSH tunnel received a text frame");
        return;
      }
      process.stdout.write(Buffer.from(data));
    });
    socket.on("unexpected-response", (request, response) => {
      request.destroy();
      finish(new Error(`SSH tunnel rejected (HTTP ${response.statusCode})`));
    });
    socket.on("error", finish);
    socket.on("close", (code, reason) => {
      if (code === 1000) finish();
      else finish(new Error(reason.toString() || `SSH tunnel closed (${code})`));
    });
  });
}


export async function resolveNode(client, selector) {
  const nodes = await client.listNodes();
  const node = nodes.find(
    (candidate) => candidate.id === selector || candidate.name === selector,
  );
  if (!node) throw new Error(`node "${selector}" not found`);
  if (!node.connected) throw new Error(`node "${node.name}" is not connected`);
  return node;
}


async function selectTarget(client, sandboxId) {
  let target;
  try {
    target = await client.selectSshTarget(sandboxId);
  } catch (error) {
    if (error.status === 404) {
      throw new Error(`sandbox "${sandboxId}" not found or unavailable`);
    }
    throw error;
  }
  return target;
}


export async function ssh(config, sandboxId, options) {
  const client = makeClient(config);
  if (options.list) {
    if (sandboxId || options.new !== undefined) {
      throw new Error("--list cannot be combined with a sandbox or --new");
    }
    printTargets(await client.listSshTargets());
    return;
  }

  if (options.new !== undefined) {
    if (sandboxId) throw new Error("--new cannot be combined with a sandbox");
    let nodeId;
    if (typeof options.new === "string") {
      nodeId = (await resolveNode(client, options.new)).id;
    }
    const sandbox = await client.createSandbox(undefined, { nodeId });
    process.stdout.write(`${sandbox.id}\n`);
    sandboxId = sandbox.id;
  }

  if (!sandboxId) {
    throw new Error("specify a sandbox ID, --list, or --new [node]");
  }
  await runSsh(config, await selectTarget(client, sandboxId));
}
