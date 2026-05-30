import net from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import des from "des.js";

const [targetHost, targetPortRaw, sandboxIdRaw] = process.argv.slice(2);
const targetPort = Number(targetPortRaw);
const sandboxId = (sandboxIdRaw || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_");
const vncPassword = process.env.CIDER_VNC_PASSWORD || "";
const logDir = join(homedir(), ".cider", "logs");
mkdirSync(logDir, { recursive: true });
const logPath = join(logDir, `vnc-proxy-${sandboxId}-${process.pid}.log`);

function log(message) {
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

if (!targetHost || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
  process.send?.({ error: "invalid VNC proxy target" });
  process.exit(1);
}

const RFB_3_8 = Buffer.from("RFB 003.008\n", "ascii");

function reverseByteBits(value) {
  let out = 0;
  for (let i = 0; i < 8; i += 1) {
    out = (out << 1) | ((value >> i) & 1);
  }
  return out;
}

function vncAuthResponse(challenge) {
  const key = Buffer.alloc(8);
  Buffer.from(vncPassword, "utf8").copy(key, 0, 0, 8);
  for (let i = 0; i < key.length; i += 1) {
    key[i] = reverseByteBits(key[i]);
  }
  const cipher = des.DES.create({ type: "encrypt", key });
  cipher.padding = false;
  return Buffer.from(cipher.update(challenge).concat(cipher.final()));
}

const server = net.createServer((client) => {
  const upstream = net.connect({ host: targetHost, port: targetPort });
  let clientBuffer = Buffer.alloc(0);
  let upstreamBuffer = Buffer.alloc(0);
  let clientState = "protocol";
  let upstreamState = "protocol";
  let clientProtocol = "3.8";
  const localChallenge = randomBytes(16);
  const expectedLocalResponse = vncAuthResponse(localChallenge);
  let localAuthDone = false;
  let upstreamAuthDone = false;
  const queuedClientData = [];

  log("client connected");

  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
  };

  client.on("data", (chunk) => {
    if (upstream.destroyed) return;
    clientBuffer = Buffer.concat([clientBuffer, chunk]);

    if (clientState === "protocol") {
      if (clientBuffer.length < 12) return;
      const protocol = clientBuffer.subarray(0, 12).toString("ascii").trim();
      clientProtocol = protocol === "RFB 003.003" ? "3.3" : "3.8";
      log(`client protocol ${protocol} -> RFB 003.008`);
      upstream.write(RFB_3_8);
      clientBuffer = clientBuffer.subarray(12);
      clientState = clientProtocol === "3.3" ? "authenticating" : "security-selection";
    }

    if (clientState === "security-selection") {
      if (clientBuffer.length < 1) return;
      const selected = clientBuffer[0];
      log(`client selected security type ${selected}`);
      if (selected !== 2) {
        closeBoth();
        return;
      }
      upstream.write(Buffer.from([2]));
      client.write(localChallenge);
      const rest = clientBuffer.subarray(1);
      if (rest.length > 0) queuedClientData.push(rest);
      clientBuffer = Buffer.alloc(0);
      clientState = "local-auth-response";
      return;
    }

    if (clientState === "local-auth-response") {
      if (clientBuffer.length < 16) return;
      const response = clientBuffer.subarray(0, 16);
      if (
        response.length !== expectedLocalResponse.length ||
        !timingSafeEqual(response, expectedLocalResponse)
      ) {
        log("client local VncAuth failed");
        client.write(Buffer.from([0, 0, 0, 1]));
        closeBoth();
        return;
      }
      log("client local VncAuth succeeded");
      localAuthDone = true;
      const rest = clientBuffer.subarray(16);
      if (rest.length > 0) queuedClientData.push(rest);
      clientBuffer = Buffer.alloc(0);
      releaseIfReady();
      return;
    }

    if (clientState === "waiting-upstream-auth") {
      if (clientBuffer.length > 0) queuedClientData.push(clientBuffer);
      clientBuffer = Buffer.alloc(0);
      return;
    }

    upstream.write(clientBuffer);
    clientBuffer = Buffer.alloc(0);
  });

  client.on("error", (err) => {
    log(`client error: ${err.message}`);
    closeBoth();
  });
  client.on("close", () => {
    log("client closed");
    upstream.destroy();
  });

  upstream.on("connect", () => log(`upstream connected ${targetHost}:${targetPort}`));
  upstream.on("error", (err) => {
    log(`upstream error: ${err.message}`);
    closeBoth();
  });
  upstream.on("close", () => {
    log("upstream closed");
    client.destroy();
  });
  upstream.on("data", (chunk) => {
    if (upstreamState === "passthrough") {
      client.write(chunk);
      return;
    }

    upstreamBuffer = Buffer.concat([upstreamBuffer, chunk]);

    if (upstreamState === "protocol") {
      if (upstreamBuffer.length < 12) return;
      log(`upstream protocol ${upstreamBuffer.subarray(0, 12).toString("ascii").trim()} -> RFB 003.008`);
      client.write(RFB_3_8);
      upstreamBuffer = upstreamBuffer.subarray(12);
      upstreamState = "security-types";
    }

    if (upstreamState === "security-types") {
      if (upstreamBuffer.length < 1) return;
      const count = upstreamBuffer[0];
      if (count === 0) {
        log("upstream reported zero security types");
        client.write(upstreamBuffer);
        upstreamState = "passthrough";
        upstreamBuffer = Buffer.alloc(0);
        return;
      }
      if (upstreamBuffer.length < 1 + count) return;

      const types = upstreamBuffer.subarray(1, 1 + count);
      log(`upstream security types [${Array.from(types).join(", ")}]`);
      if (!types.includes(2)) {
        log("upstream did not offer VncAuth type 2; closing");
        closeBoth();
        return;
      }

      log("advertised local VncAuth to Screen Sharing");
      if (clientProtocol === "3.3") {
        // RFB 3.3 sends a single uint32 security type and has no client
        // security-selection byte. Apple's native Screen Sharing currently
        // chooses 3.3, so send a local VncAuth challenge immediately.
        client.write(Buffer.from([0, 0, 0, 2]));
        client.write(localChallenge);
        upstream.write(Buffer.from([2]));
        clientState = "local-auth-response";
        log("client is RFB 3.3; started local and upstream VncAuth");
      } else {
        client.write(Buffer.from([1, 2]));
      }
      upstreamBuffer = upstreamBuffer.subarray(1 + count);
      upstreamState = "auth-challenge";
    }

    if (upstreamState === "auth-challenge") {
      if (upstreamBuffer.length < 16) return;
      const challenge = upstreamBuffer.subarray(0, 16);
      upstream.write(vncAuthResponse(challenge));
      log("sent VncAuth response upstream");
      upstreamBuffer = upstreamBuffer.subarray(16);
      upstreamState = "auth-result";
    }

    if (upstreamState === "auth-result") {
      if (upstreamBuffer.length < 4) return;
      const result = upstreamBuffer.readUInt32BE(0);
      if (result !== 0) {
        log(`upstream VncAuth failed with result ${result}`);
        client.write(upstreamBuffer.subarray(0, 4));
        closeBoth();
        return;
      }
      log("upstream VncAuth succeeded; released client passthrough");
      upstreamAuthDone = true;
      upstreamBuffer = upstreamBuffer.subarray(4);
      upstreamState = "passthrough";
      releaseIfReady();
      upstreamBuffer = Buffer.alloc(0);
    }
  });

  function releaseIfReady() {
    if (!localAuthDone) {
      return;
    }
    if (!upstreamAuthDone) {
      clientState = "waiting-upstream-auth";
      return;
    }
    client.write(Buffer.alloc(4));
    clientState = "passthrough";
    for (const queued of queuedClientData.splice(0)) upstream.write(queued);
    if (upstreamBuffer.length > 0) client.write(upstreamBuffer);
  }
});

let idleTimer = null;
let connections = 0;

function armIdleExit(ms) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    server.close(() => process.exit(0));
  }, ms);
}

server.on("connection", (socket) => {
  connections += 1;
  if (idleTimer) clearTimeout(idleTimer);
  socket.on("close", () => {
    connections -= 1;
    if (connections === 0) armIdleExit(30_000);
  });
});

server.on("error", (err) => {
  log(`server error: ${err.message}`);
  process.send?.({ error: err.message });
  process.exit(1);
});

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  if (!addr || typeof addr !== "object") {
    process.send?.({ error: "VNC proxy did not bind a TCP port" });
    process.exit(1);
  }
  log(`listening on 127.0.0.1:${addr.port}, target ${targetHost}:${targetPort}`);
  process.send?.({ ready: true, port: addr.port, logPath });
  armIdleExit(120_000);
});
