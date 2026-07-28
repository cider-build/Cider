import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { ApiError, makeClient } from "./api.js";
import {
  CIDER_HOME,
  NODE_URL,
  readConfig,
  readNodeState,
  writeConfig,
  writeNodeState,
} from "./config.js";
import { confirm, passwordQuestion, question } from "./prompts.js";
import { holdConnection } from "./tunnel.js";

const exec = promisify(execFile);
const IMAGE_NAME = "cider-base-v0.1.0";
const DEFAULT_IMAGE_REF = "ghcr.io/cirruslabs/macos-sequoia-base:latest";
const SSH_USER = process.env.CIDER_SSH_USER || "admin";
const SSH_KEY_PATH = process.env.CIDER_SSH_KEY || join(CIDER_HOME, "ssh_key");
// The password the base image ships with, used once to install the Cider SSH key.
const IMAGE_PASSWORD = process.env.CIDER_IMAGE_PASSWORD || "admin";
const PROVISION_SSH_TIMEOUT_MS = 30_000;
const PROVISION_DEADLINE_MS = 120_000;
const BASE_SSH_OPTIONS = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "LogLevel=ERROR",
];

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function authenticatedConfig() {
  let config = readConfig();
  if (config.token) {
    try {
      await makeClient(config).me();
      return config;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      config = { apiUrl: config.apiUrl };
      await writeConfig(config);
      process.stdout.write("Your Cider login has expired.\n");
    }
  }

  process.stdout.write("Log in to Cider\n");
  const email = await question("Email: ");
  const password = await passwordQuestion("Password: ");
  const auth = await makeClient(config).cliLogin(email, password);
  config = { apiUrl: config.apiUrl, token: auth.token };
  await writeConfig(config);
  process.stdout.write(`Authenticated as ${auth.user.email} (${auth.organization.name})\n`);
  return config;
}

async function ensureSshKey() {
  if (!await pathExists(SSH_KEY_PATH)) {
    await mkdir(dirname(SSH_KEY_PATH), { recursive: true, mode: 0o700 });
    await exec("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "cider-node", "-f", SSH_KEY_PATH]);
  }
  return (await readFile(`${SSH_KEY_PATH}.pub`, "utf8")).trim();
}

async function ensureImage({ assumeYes, imageRef }) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Cider nodes require Apple Silicon running macOS");
  }
  await exec("tart", ["--version"]);
  const tartHome = join(CIDER_HOME, "images", "tart");
  const imagePath = join(tartHome, "vms", IMAGE_NAME);
  if (await pathExists(imagePath)) return { imagePath, tartHome };

  const install = assumeYes || await confirm(`Cider image is not installed at ${imagePath}. Install it now?`);
  if (!install) throw new Error("Cider image installation declined");
  process.stdout.write(`Installing ${imageRef} into ${imagePath}. This is a large download.\n`);
  await exec("tart", ["clone", imageRef, IMAGE_NAME], {
    env: { ...process.env, TART_HOME: tartHome },
    maxBuffer: 1024 * 1024 * 10,
  });
  if (!await pathExists(imagePath)) {
    throw new Error(`Tart completed without creating ${imagePath}`);
  }
  return { imagePath, tartHome };
}

async function installAuthorizedKey(ip, publicKey) {
  const dir = await mkdtemp(join(tmpdir(), "cider-askpass-"));
  const askpass = join(dir, "askpass.sh");
  await writeFile(askpass, `#!/bin/sh\nprintf '%s' ${shellQuote(IMAGE_PASSWORD)}\n`, { mode: 0o700 });
  const env = { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: "force" };
  const command =
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
    `printf '%s\\n' ${shellQuote(publicKey)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
  const deadline = Date.now() + PROVISION_DEADLINE_MS;
  try {
    while (true) {
      try {
        await exec("ssh", [
          ...BASE_SSH_OPTIONS,
          "-o", "PreferredAuthentications=password",
          "-o", "PubkeyAuthentication=no",
          "-o", "NumberOfPasswordPrompts=1",
          "-o", "ConnectTimeout=5",
          `${SSH_USER}@${ip}`,
          command,
        ], { env, timeout: PROVISION_SSH_TIMEOUT_MS });
        return;
      } catch (error) {
        if (Date.now() >= deadline) {
          const detail = (error.stderr || "").toString().trim() || error.message;
          throw new Error(`could not install the Cider SSH key in the base VM as ${SSH_USER}: ${detail}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function provisionImage(image, publicKey) {
  process.stdout.write("Provisioning the Cider image with the node SSH key. This boots the base VM once.\n");
  const env = { ...process.env, TART_HOME: image.tartHome };
  const vm = spawn("tart", ["run", "--no-graphics", IMAGE_NAME], { env, stdio: "ignore" });
  const vmExited = new Promise((resolve) => {
    vm.once("exit", resolve);
    vm.once("error", resolve);
  });
  try {
    const ip = (await exec("tart", ["ip", IMAGE_NAME, "--wait", "120"], { env })).stdout.trim();
    await installAuthorizedKey(ip, publicKey);
    await exec("ssh", [
      "-i", SSH_KEY_PATH,
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      ...BASE_SSH_OPTIONS,
      `${SSH_USER}@${ip}`,
      "true",
    ], { timeout: PROVISION_SSH_TIMEOUT_MS });
    process.stdout.write("Verified key-based SSH access to the base VM.\n");
  } finally {
    await exec("tart", ["stop", IMAGE_NAME, "--timeout", "30"], { env }).catch(() => vm.kill("SIGKILL"));
    await vmExited;
  }
}

async function ensureProvisionedImage(image, publicKey) {
  const markerPath = join(CIDER_HOME, "images", `${IMAGE_NAME}.provisioned`);
  if (await pathExists(markerPath) && await readFile(markerPath, "utf8") === publicKey) return;
  await provisionImage(image, publicKey);
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, publicKey);
}

// Enrolling is idempotent per organization and name: the backend reactivates an offline
// node of the same name with a freshly rotated credential, so a stale local token heals here.
async function enrollment(config, name) {
  const nodeName = name || readNodeState()?.name || hostname();
  let enrolled;
  try {
    enrolled = await makeClient(config).enrollNode(nodeName);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new Error(`a node named "${nodeName}" is already connected; disconnect it, pass --name, or retry in a minute if it just went offline`);
    }
    throw error;
  }
  const state = { id: enrolled.id, name: enrolled.name, token: enrolled.token };
  await writeNodeState(state);
  return state;
}

async function startNodeService(command, image) {
  const child = spawn(command, [], {
    env: {
      ...process.env,
      CIDER_BASE_VM: IMAGE_NAME,
      CIDER_NODE_PORT: "8001",
      CIDER_SSH_KEY: SSH_KEY_PATH,
      CIDER_SSH_USER: SSH_USER,
      TART_HOME: image.tartHome,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  try {
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 30_000;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        child.off("error", fail);
        child.off("exit", exited);
      };
      const succeed = () => {
        cleanup();
        resolve();
      };
      const fail = (error) => {
        cleanup();
        reject(error);
      };
      const exited = (code, signal) => fail(new Error(`cider-node exited during startup (${signal || code})`));
      const poll = async () => {
        try {
          const response = await fetch(`${NODE_URL}/health`);
          if (response.ok) {
            succeed();
            return;
          }
        } catch (error) {
          if (!(error instanceof TypeError)) {
            fail(error);
            return;
          }
        }
        if (Date.now() >= deadline) {
          fail(new Error("cider-node did not become healthy within 30 seconds"));
          return;
        }
        timer = setTimeout(poll, 100);
      };
      child.once("error", fail);
      child.once("exit", exited);
      poll();
    });
  } catch (error) {
    await stopNodeService(child);
    throw error;
  }
  return child;
}

async function stopNodeService(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

export async function connect(options) {
  const config = await authenticatedConfig();
  const imageRef = options.image || process.env.CIDER_IMAGE_REF || DEFAULT_IMAGE_REF;
  const publicKey = await ensureSshKey();
  const image = await ensureImage({ assumeYes: options.yes, imageRef });
  await ensureProvisionedImage(image, publicKey);
  const node = await enrollment(config, options.name);
  process.stdout.write(`Image ready: ${image.imagePath}\n`);
  const nodeCommand = options.nodeCommand || process.env.CIDER_NODE_COMMAND || "cider-node";
  const service = await startNodeService(nodeCommand, image);
  try {
    await holdConnection(config, node);
  } finally {
    await stopNodeService(service);
  }
}
