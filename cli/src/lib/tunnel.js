import { PassThrough } from "node:stream";

import WebSocket from "ws";

import { NODE_URL } from "./config.js";

const CHUNK_SIZE = 256 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;
const LIVENESS_TIMEOUT_MS = 60_000;
const RECONNECT_MIN_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const STABLE_CONNECTION_MS = 60_000;
const TERMINAL_CLOSE_CODES = new Set([1003, 1008]);

function websocketUrl(apiUrl, nodeId) {
  const url = new URL(apiUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error(`unsupported Cider API protocol: ${url.protocol}`);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/node-connections/${nodeId}`;
  url.search = "";
  return url.toString();
}

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

export async function holdConnection(config, node, nodeUrl = NODE_URL) {
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
        await runConnection(config, node, nodeUrl, state);
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

function runConnection(config, node, nodeUrl, state) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl(config.apiUrl, node.id), {
      headers: { Authorization: `Bearer ${node.token}` },
      handshakeTimeout: 15_000,
    });
    state.socket = socket;
    const requests = new Map();
    let lastActivity = Date.now();
    let heartbeat;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      if (state.socket === socket) state.socket = null;
      for (const request of requests.values()) request.body.destroy();
      requests.clear();
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
          if (!request.body.write(frame.subarray(17))) {
            socket.pause();
            request.body.once("drain", () => socket.resume());
          }
          if (frame[16] === 1) {
            requests.delete(id);
            request.body.end();
          }
          return;
        }

        const message = JSON.parse(data.toString());
        if (message.type === "heartbeat_ack") return;
        if (message.type !== "request" || !message.id || !message.method || !message.path) {
          throw new Error("invalid tunnel control message");
        }
        const request = { ...message, body: new PassThrough() };
        requests.set(message.id, request);
        forwardRequest(socket, request, nodeUrl).catch((error) => {
          requests.delete(request.id);
          request.body.destroy();
          sendErrorResponse(socket, request.id, error).catch(() => socket.terminate());
        });
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

function socketSend(socket, data) {
  return new Promise((resolve, reject) => {
    socket.send(data, (error) => error ? reject(error) : resolve());
  });
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
    duplex: hasBody ? "half" : undefined,
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
