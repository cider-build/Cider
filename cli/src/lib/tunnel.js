import WebSocket from "ws";

import { NODE_URL } from "./config.js";
import { closeSocket, socketSend, waitForOpen, websocketUrl } from "./websocket.js";

const CHUNK_SIZE = 256 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;
const LIVENESS_TIMEOUT_MS = 60_000;
const RECONNECT_MIN_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const STABLE_CONNECTION_MS = 60_000;
const TERMINAL_CLOSE_CODES = new Set([1003, 1008]);

function reconnectDelay(state, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.wake = null;
      resolve();
    }, ms);
    state.wake = () => {
      clearTimeout(timer);
      state.wake = null;
      resolve();
    };
  });
}

export async function holdConnection(config, node, metadata, nodeUrl = NODE_URL) {
  const state = { stopping: false, socket: null, wake: null };
  const shutdown = () => {
    state.stopping = true;
    if (state.socket) {
      if (state.socket.readyState === WebSocket.OPEN) state.socket.close(1000, "connector stopped");
      else state.socket.terminate();
    }
    if (state.wake) state.wake();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let delay = RECONNECT_MIN_DELAY_MS;
  try {
    while (!state.stopping) {
      const startedAt = Date.now();
      try {
        await runConnection(config, node, metadata, nodeUrl, state);
        return;
      } catch (error) {
        if (state.stopping) return;
        if (error.terminal) {
          throw error.hint ? new Error(`${error.message}; ${error.hint}`) : error;
        }
        if (Date.now() - startedAt >= STABLE_CONNECTION_MS) delay = RECONNECT_MIN_DELAY_MS;
        process.stderr.write(`Node connection lost (${error.message}); reconnecting in ${Math.round(delay / 1000)}s\n`);
        await reconnectDelay(state, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
      }
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }
}

function runConnection(config, node, metadata, nodeUrl, state) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl(config.apiUrl, `/node-connections/${node.id}`), {
      headers: {
        Authorization: `Bearer ${node.token}`,
        "X-Cider-Node-Metadata": Buffer.from(JSON.stringify(metadata)).toString("base64"),
      },
      handshakeTimeout: 15_000,
    });
    state.socket = socket;
    const requests = new Map();
    const sshTunnels = new Set();
    let lastActivity = Date.now();
    let heartbeat;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      if (state.socket === socket) state.socket = null;
      for (const request of requests.values()) request.controller.abort();
      requests.clear();
      for (const tunnel of sshTunnels) {
        closeSocket(tunnel.upstream);
        closeSocket(tunnel.downstream);
      }
      sshTunnels.clear();
      if (error) reject(error);
      else resolve();
    };

    socket.on("open", () => {
      if (state.stopping) {
        socket.close(1000, "connector stopped");
        return;
      }
      lastActivity = Date.now();
      process.stdout.write(`Connected ${node.name} to Cider. Press Ctrl+C to disconnect.\n`);
      heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastActivity > LIVENESS_TIMEOUT_MS) {
          socket.terminate();
          return;
        }
        socket.send(JSON.stringify({ type: "heartbeat" }));
      }, HEARTBEAT_INTERVAL_MS);
    });

    socket.on("message", (data, isBinary) => {
      lastActivity = Date.now();
      try {
        if (isBinary) {
          const frame = Buffer.from(data);
          if (frame.length < 17) throw new Error("invalid tunnel frame");
          const id = frame.subarray(0, 16).toString("hex");
          const request = requests.get(id);
          if (!request) return;
          if (request.forwarding) throw new Error("tunnel request body received after final frame");
          const chunk = frame.subarray(17);
          request.received += chunk.length;
          if (request.received > request.body_length) throw new Error("tunnel request body exceeds declared length");
          request.chunks.push(chunk);
          if (frame[16] === 1) {
            if (request.received !== request.body_length) throw new Error("tunnel request body length mismatch");
            request.body = Buffer.concat(request.chunks, request.received);
            request.chunks = [];
            request.forwarding = true;
            forwardRequest(socket, request, nodeUrl)
              .catch((error) => sendErrorResponse(socket, request.id, error))
              .catch(() => socket.terminate())
              .finally(() => requests.delete(request.id));
          }
          return;
        }

        const message = JSON.parse(data.toString());
        if (message.type === "heartbeat_ack") return;
        if (message.type === "ssh_open") {
          if (
            !/^[0-9a-f]{32}$/.test(message.id)
            || typeof message.sandbox_id !== "string"
            || !message.sandbox_id.startsWith("cider-")
          ) {
            throw new Error("invalid SSH tunnel request");
          }
          const tunnel = { upstream: null, downstream: null };
          sshTunnels.add(tunnel);
          openSshTunnel(config, node, nodeUrl, message, tunnel)
            .catch(async (error) => {
              if (socket.readyState === WebSocket.OPEN) {
                await socketSend(socket, JSON.stringify({
                  type: "ssh_error",
                  id: message.id,
                  detail: error.message,
                }));
              }
            })
            .catch(() => socket.terminate())
            .finally(() => sshTunnels.delete(tunnel));
          return;
        }
        if (message.type !== "request" || !message.id || !message.method || !message.path) {
          throw new Error("invalid tunnel control message");
        }
        if (!Number.isSafeInteger(message.body_length) || message.body_length < 0) {
          throw new Error("invalid tunnel request body length");
        }
        const request = {
          ...message,
          chunks: [],
          received: 0,
          forwarding: false,
          controller: new AbortController(),
        };
        requests.set(message.id, request);
      } catch {
        socket.close(1003, "invalid gateway message");
      }
    });

    socket.on("unexpected-response", (request, response) => {
      request.destroy();
      const error = new Error(`node connection rejected (HTTP ${response.statusCode})`);
      if (response.statusCode === 401 || response.statusCode === 403) {
        error.terminal = true;
        error.hint = "run `cider connect` again to re-enroll this Mac";
      }
      finish(error);
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", (code, reason) => {
      if (code === 1000) {
        finish();
        return;
      }
      const error = new Error(`node connection closed (${code}): ${reason.toString()}`);
      if (TERMINAL_CLOSE_CODES.has(code)) error.terminal = true;
      if (code === 1008) error.hint = "run `cider connect` again to re-enroll this Mac";
      finish(error);
    });
  });
}

function bridgeWebSockets(first, second) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      closeSocket(first);
      closeSocket(second);
      if (error) reject(error);
      else resolve();
    };
    const forward = (destination) => (data, isBinary) => {
      if (destination.readyState !== WebSocket.OPEN) return;
      // Preserve the protocol distinction between terminal data and control frames.
      destination.send(isBinary ? data : data.toString(), { binary: isBinary }, (error) => {
        if (error) finish(error);
      });
    };
    first.on("message", forward(second));
    second.on("message", forward(first));
    first.once("error", finish);
    second.once("error", finish);
    first.once("close", () => finish());
    second.once("close", () => finish());
  });
}

async function openSshTunnel(config, node, nodeUrl, message, tunnel) {
  tunnel.downstream = new WebSocket(
    websocketUrl(
      nodeUrl,
      `/sandboxes/${encodeURIComponent(message.sandbox_id)}/ssh`,
    ),
    { handshakeTimeout: 30_000 },
  );
  await waitForOpen(tunnel.downstream, "cider-node");

  tunnel.upstream = new WebSocket(
    websocketUrl(
      config.apiUrl,
      `/node-ssh/${encodeURIComponent(node.id)}/${message.id}`,
    ),
    {
      headers: { Authorization: `Bearer ${node.token}` },
      handshakeTimeout: 30_000,
    },
  );
  await waitForOpen(tunnel.upstream, "Cider backend");
  await bridgeWebSockets(tunnel.downstream, tunnel.upstream);
}

async function sendBody(socket, id, body) {
  const identifier = Buffer.from(id, "hex");
  if (body.length === 0) {
    await socketSend(socket, Buffer.concat([identifier, Buffer.from([1])]));
    return;
  }
  for (let offset = 0; offset < body.length; offset += CHUNK_SIZE) {
    const chunk = body.subarray(offset, offset + CHUNK_SIZE);
    const final = offset + chunk.length === body.length ? 1 : 0;
    await socketSend(socket, Buffer.concat([identifier, Buffer.from([final]), chunk]));
  }
}

export async function forwardRequest(socket, request, nodeUrl = NODE_URL) {
  const headers = new Headers(request.headers || {});
  headers.delete("host");
  headers.delete("connection");
  headers.delete("transfer-encoding");
  const hasBody = request.body_length > 0 && request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(`${nodeUrl}${request.path}`, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    signal: request.controller.signal,
  });
  const responseHeaders = {};
  for (const [key, value] of response.headers) responseHeaders[key] = value;
  await socketSend(socket, JSON.stringify({
    type: "response",
    id: request.id,
    status: response.status,
    headers: responseHeaders,
  }));
  if (response.body) {
    for await (const chunk of response.body) {
      const body = Buffer.from(chunk);
      for (let offset = 0; offset < body.length; offset += CHUNK_SIZE) {
        await socketSend(socket, Buffer.concat([
          Buffer.from(request.id, "hex"),
          Buffer.from([0]),
          body.subarray(offset, offset + CHUNK_SIZE),
        ]));
      }
    }
  }
  await socketSend(socket, Buffer.concat([Buffer.from(request.id, "hex"), Buffer.from([1])]));
}

async function sendErrorResponse(socket, id, error) {
  const body = Buffer.from(JSON.stringify({ detail: `node proxy failed: ${error.message}` }));
  await socketSend(socket, JSON.stringify({
    type: "response",
    id,
    status: 502,
    headers: { "content-type": "application/json" },
  }));
  await sendBody(socket, id, body);
}
