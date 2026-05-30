import { lstat } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import open from "open";

import {
  readConfig,
  readSandboxLink,
  writeSandboxLink,
  clearSandboxLink,
} from "../lib/config.js";
import { makeClient, APIError } from "../lib/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUEST_SHARE_ROOT = "/Volumes/My Shared Files/cider";

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function resolveOpenTarget(pathArg) {
  const hostPath = resolvePath(pathArg || process.cwd());
  if (hostPath.includes(":")) {
    throw new Error("Cider cannot mount paths containing ':'.");
  }

  let info;
  try {
    info = await lstat(hostPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Path does not exist: ${hostPath}`);
    }
    throw err;
  }

  const hostMountPath = info.isDirectory() ? hostPath : dirname(hostPath);
  const guestOpenPath = info.isDirectory()
    ? GUEST_SHARE_ROOT
    : `${GUEST_SHARE_ROOT}/${basename(hostPath)}`;
  const guestTerminalPath = info.isDirectory() ? guestOpenPath : GUEST_SHARE_ROOT;
  return {
    hostPath,
    hostMountPath,
    guestOpenPath,
    guestTerminalPath,
    linkDir: hostMountPath,
  };
}

function extractVncPassword(vncUrl) {
  const match = vncUrl.match(/^vnc:\/\/[^:]*:([^@]+)@/);
  if (!match) {
    throw new Error("Backend did not return a password-bearing VNC URL.");
  }
  const password = decodeURIComponent(match[1]);
  extractVncPassword.lastPassword = password;
  return password;
}

function startVncProxy(targetHost, sandboxId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(__dirname, "../lib/vnc-proxy-child.js"), targetHost, "5900", sandboxId],
      {
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, CIDER_VNC_PASSWORD: extractVncPassword.lastPassword },
      }
    );

    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    child.on("message", (msg) => {
      if (msg && msg.ready && Number.isInteger(msg.port)) {
        child.disconnect();
        child.unref();
        settle(resolve, { port: msg.port, pid: child.pid, logPath: msg.logPath });
      } else if (msg && msg.error) {
        settle(reject, new Error(msg.error));
      }
    });
    child.on("error", (err) => settle(reject, err));
    child.on("exit", (code) => {
      settle(reject, new Error(`VNC proxy exited before it was ready (${code}).`));
    });
  });
}

function pickNode(nodes, requestedId) {
  if (requestedId) {
    const found = nodes.find((n) => n.id === requestedId);
    if (!found) {
      throw new Error(
        `Node "${requestedId}" not found. Available: ${nodes.map((n) => n.id).join(", ") || "(none)"}`
      );
    }
    return found;
  }
  const healthy = nodes.filter((n) => n.last_ping_ok === true);
  if (healthy.length > 0) {
    healthy.sort((a, b) => (b.last_ping_at || "").localeCompare(a.last_ping_at || ""));
    return healthy[0];
  }
  throw new Error(
    nodes.length > 0
      ? "No healthy compute nodes are available."
      : "No compute nodes are registered. Add one in the dashboard first."
  );
}

async function findExisting(client, id) {
  // No GET /sandboxes/{id} endpoint exists; list-and-filter is the only way.
  const all = await client.listSandboxes();
  return all.find((s) => s.id === id) ?? null;
}

export async function openCommand(pathArg, opts) {
  const config = await readConfig();
  if (!config.token) {
    process.stderr.write("Not signed in. Run `cider login` first.\n");
    process.exit(1);
  }

  const target = await resolveOpenTarget(pathArg);
  const client = makeClient(config);

  let sandbox = null;
  let createdLink = null;
  const link = await readSandboxLink(target.linkDir);
  if (link && !opts.fresh) {
    const existing = await findExisting(client, link.sandbox_id);
    if (existing && existing.status === "running") {
      if (link.mount_path !== target.hostMountPath) {
        throw new Error(
          `Linked sandbox ${link.sandbox_id} was not created for ${target.hostPath}. Run \`cider open ${shellQuote(target.hostPath)} --fresh\` to create one with this mount.`
        );
      }
      sandbox = existing;
      process.stdout.write(
        `Reusing sandbox ${sandbox.id} (linked to ${target.linkDir}).\n`
      );
    } else {
      process.stdout.write(
        `Linked sandbox ${link.sandbox_id} is ${existing ? existing.status : "missing"}; creating a new one.\n`
      );
      await clearSandboxLink(target.linkDir);
    }
  }

  if (!sandbox) {
    const nodes = await client.listNodes();
    const node = pickNode(nodes, opts.node);
    process.stdout.write(`Creating sandbox on node ${node.name} (${node.id})...\n`);
    try {
      sandbox = await client.createSandbox(node.id, {
        mountPath: target.hostMountPath,
      });
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        process.stderr.write(
          "Session expired. Run `cider login` to sign in again.\n"
        );
        process.exit(1);
      }
      throw err;
    }
    createdLink = {
      sandbox_id: sandbox.id,
      node_id: sandbox.node_id,
      mount_path: target.hostMountPath,
      guest_path: target.guestOpenPath,
      terminal_path: target.guestTerminalPath,
      created_at: sandbox.created_at,
    };
    process.stdout.write(`Created sandbox ${sandbox.id}.\n`);
  }

  // Connect-info can race the VM's boot — exec/connect both 409 with
  // "sandbox is pending" until the node reports running. Poll briefly.
  let conn = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      conn = await client.connectSandbox(sandbox.id);
      break;
    } catch (err) {
      if (err instanceof APIError && err.status === 409) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  if (!conn) {
    throw new Error(
      "Sandbox did not become reachable in time. Try `cider open` again."
    );
  }

  process.stdout.write(`\nSandbox:    ${sandbox.id}\n`);
  process.stdout.write(`IP:         ${conn.ip}\n`);
  process.stdout.write(`VNC URL:    ${conn.vnc_url}\n`);
  process.stdout.write(`SSH URL:    ${conn.ssh_url}\n`);

  const openResult = await client.execSandbox(
    sandbox.id,
    `/usr/bin/open -a Terminal -- ${shellQuote(target.guestTerminalPath)}`
  );
  if (openResult.exit_code !== 0) {
    await clearSandboxLink(target.linkDir);
    throw new Error(
      `Could not open Terminal at ${target.guestTerminalPath} in the VM: ${openResult.stderr || openResult.stdout}`
    );
  }
  if (createdLink) {
    await writeSandboxLink(target.linkDir, createdLink);
    process.stdout.write(
      `Saved link to ${target.linkDir}/.cider/sandbox.json.\n`
    );
  }
  process.stdout.write(`Terminal:   ${target.guestTerminalPath}\n`);

  if (opts.open !== false) {
    const password = extractVncPassword(conn.vnc_url);
    const proxy = await startVncProxy(conn.ip, sandbox.id);
    const screenSharingUrl =
      `vnc://:${encodeURIComponent(password)}@127.0.0.1:${proxy.port}`;

    process.stdout.write(
      `\nOpening Screen Sharing through local VNC auth shim (pid ${proxy.pid}).\n`
    );
    process.stdout.write(`Shim log:   ${proxy.logPath}\n`);
    try {
      await open(screenSharingUrl);
    } catch (err) {
      process.stderr.write(
        `warning: could not auto-open Screen Sharing: ${err.message}\n`
      );
    }
  }
}
