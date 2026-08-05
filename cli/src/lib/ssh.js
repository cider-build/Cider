import WebSocket from "ws";

import { makeClient } from "./api.js";
import { printTable } from "./table.js";
import { websocketUrl } from "./websocket.js";


function runSsh(config, target) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl(config.apiUrl, `/ssh/${target.sandbox_id}`), {
      headers: { Authorization: `Bearer ${config.token}` },
      handshakeTimeout: 30_000,
    });
    let settled = false;
    let raw = false;

    const onData = (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    };
    const onEnd = () => {
      // Send EOT, then allow buffered remote output to flush.
      if (socket.readyState === WebSocket.OPEN) socket.send(Buffer.from([4]));
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, "stdin closed");
      }, 750);
    };
    const onSignal = () => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "CLI stopped");
      else socket.terminate();
    };
    const cleanup = () => {
      process.stdout.off("resize", sendResize);
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

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          term: process.env.TERM || "xterm-256color",
          resize: {
            cols: process.stdout.columns || 80,
            rows: process.stdout.rows || 24,
          },
        }),
      );
    };
    socket.on("open", () => {
      process.stderr.write(
        `Connecting to ${target.sandbox_id} on ${target.node_name}\n`,
      );
      // Initialize the remote PTY before terminal data.
      sendResize();
      process.stdout.on("resize", sendResize);
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
      throw new Error(`"${sandboxId}" is not an available sandbox or running server`);
    }
    throw error;
  }
  return target;
}


async function resolveTargetId(client, selector) {
  const targets = await client.listSshTargets();
  const byName = targets.find((target) => target.server_name === selector);
  return byName ? byName.sandbox_id : selector;
}

export async function ssh(config, sandboxId, options) {
  const client = makeClient(config);
  if (options.list) {
    if (sandboxId || options.new !== undefined) {
      throw new Error("--list cannot be combined with a sandbox or --new");
    }
    printTable(
      await client.listSshTargets(),
      ["sandbox_id", "server_name", "node_name", "status"],
      { emptyMessage: "No available sandboxes.", emptyValue: "-" },
    );
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
    throw new Error("specify a sandbox ID, a server name, --list, or --new [node]");
  }
  await runSsh(config, await selectTarget(client, await resolveTargetId(client, sandboxId)));
}
