import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, posix as posixPath, resolve as resolvePath } from "node:path";
import open from "open";

import {
  readConfig,
  readSandboxLink,
  writeSandboxLink,
  clearSandboxLink,
} from "../lib/config.js";
import { makeClient, APIError } from "../lib/api.js";

const GUEST_SHARE_ROOT = "/Volumes/My Shared Files/cider";
const CIDER_CONFIG_FILENAME = "cider.json";

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function redactUrlPassword(url) {
  return url.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
}

async function readProjectConfig(dir) {
  const path = join(dir, CIDER_CONFIG_FILENAME);
  try {
    const raw = await readFile(path, "utf8");
    const config = JSON.parse(raw);
    if (config.version !== 1) {
      throw new Error(`${CIDER_CONFIG_FILENAME} version must be 1.`);
    }
    const setup = config.setup ?? [];
    if (!Array.isArray(setup) || !setup.every((item) => typeof item === "string")) {
      throw new Error(`${CIDER_CONFIG_FILENAME} setup must be an array of strings.`);
    }
    if (typeof config.start !== "string" || config.start.trim() === "") {
      throw new Error(`${CIDER_CONFIG_FILENAME} start must be a non-empty string.`);
    }
    if (config.mount !== undefined && typeof config.mount !== "string") {
      throw new Error(`${CIDER_CONFIG_FILENAME} mount must be a string.`);
    }
    if (config.workdir !== undefined && typeof config.workdir !== "string") {
      throw new Error(`${CIDER_CONFIG_FILENAME} workdir must be a string.`);
    }
    return {
      mount: config.mount,
      setup,
      start: config.start,
      workdir: config.workdir,
    };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function applyProjectConfigTarget(target, projectConfig) {
  if (!projectConfig?.mount) {
    return target;
  }
  const hostMountPath = resolvePath(target.linkDir, projectConfig.mount);
  const info = await lstat(hostMountPath);
  if (!info.isDirectory()) {
    throw new Error(`${CIDER_CONFIG_FILENAME} mount must resolve to a directory.`);
  }
  const guestTerminalPath = projectConfig.workdir
    ? posixPath.join(GUEST_SHARE_ROOT, projectConfig.workdir)
    : GUEST_SHARE_ROOT;
  return {
    ...target,
    hostMountPath,
    guestOpenPath: guestTerminalPath,
    guestTerminalPath,
  };
}

function terminalCommand(target, projectConfig) {
  const cd = `cd ${shellQuote(target.guestTerminalPath)}`;
  const path = "export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH";
  if (!projectConfig) {
    return [path, cd].join(" && ");
  }
  return [path, cd, ...projectConfig.setup, projectConfig.start].join(" && ");
}

function terminalScript(command) {
  const script = `#!/bin/zsh
${command}
`;
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const path = `/tmp/cider-${Date.now()}.command`;
  return [
    `cat > ${shellQuote(path)}.b64 <<'CIDER_SCRIPT'`,
    encoded,
    "CIDER_SCRIPT",
    `/usr/bin/base64 -D -i ${shellQuote(path)}.b64 -o ${shellQuote(path)}`,
    `/bin/chmod +x ${shellQuote(path)}`,
    `/usr/bin/open -a Terminal ${shellQuote(path)}`,
  ].join("\n");
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

  let target = await resolveOpenTarget(pathArg);
  const projectConfig = await readProjectConfig(target.linkDir);
  target = await applyProjectConfigTarget(target, projectConfig);
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
  process.stdout.write(`Screen:     ${redactUrlPassword(conn.screen_sharing_url)}\n`);
  process.stdout.write(`SSH URL:    ${conn.ssh_url}\n`);

  const openResult = await client.execSandbox(
    sandbox.id,
    terminalScript(terminalCommand(target, projectConfig))
  );
  if (openResult.exit_code !== 0) {
    await clearSandboxLink(target.linkDir);
    throw new Error(
      `Could not start Terminal at ${target.guestTerminalPath} in the VM: ${openResult.stderr || openResult.stdout}`
    );
  }
  if (createdLink) {
    await writeSandboxLink(target.linkDir, createdLink);
    process.stdout.write(
      `Saved link to ${target.linkDir}/.cider/sandbox.json.\n`
    );
  }
  process.stdout.write(`Terminal:   ${target.guestTerminalPath}\n`);
  if (projectConfig) {
    process.stdout.write(`Cider:      ran ${CIDER_CONFIG_FILENAME}\n`);
  }

  if (opts.open !== false) {
    process.stdout.write("\nOpening native macOS Screen Sharing.\n");
    try {
      await open(conn.screen_sharing_url);
    } catch (err) {
      process.stderr.write(
        `warning: could not auto-open Screen Sharing: ${err.message}\n`
      );
    }
  }
}
