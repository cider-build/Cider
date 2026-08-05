import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, statfs, writeFile } from "node:fs/promises";
import { cpus, hostname, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { ApiError, makeClient } from "./api.js";
import {
  CIDER_HOME,
  NODE_PORT,
  NODE_URL,
  readConfig,
  readNodeState,
  writeConfig,
  writeNodeState,
} from "./config.js";
import { confirm, passwordQuestion, question } from "./prompts.js";
import { holdConnection } from "./tunnel.js";

const exec = promisify(execFile);
const IMAGE_NAME = "cider-base";
const DEFAULT_IMAGE = "macos-tahoe-cua:26.5.2";
const VM_STORAGE = join(CIDER_HOME, "vms");
const SSH_USER = process.env.CIDER_SSH_USER || "lume";
const SSH_KEY_PATH = process.env.CIDER_SSH_KEY || join(CIDER_HOME, "ssh_key");

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
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

// lume get uses the same exit status for missing VMs and operational failures.
async function listVms() {
  const { stdout } = await exec("lume", ["ls", "-f", "json", "--storage", VM_STORAGE]);
  return JSON.parse(stdout);
}

async function imageInstalled() {
  return (await listVms()).some((vm) => vm.name === IMAGE_NAME);
}

async function ensureImage({ assumeYes, image }) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Cider nodes require Apple Silicon running macOS");
  }
  await exec("lume", ["--version"]);
  await mkdir(VM_STORAGE, { recursive: true });
  const referencePath = join(CIDER_HOME, `${IMAGE_NAME}.image-ref`);
  if (await imageInstalled()) {
    return await pathExists(referencePath) ? (await readFile(referencePath, "utf8")).trim() : null;
  }

  const install = assumeYes || await confirm(`Cider base VM "${IMAGE_NAME}" is not installed in ${VM_STORAGE}. Create it now?`);
  if (!install) throw new Error("Cider base VM installation declined");
  process.stdout.write(`Installing ${image} as ${IMAGE_NAME}. This is a large one-time download.\n`);
  const pull = spawn("lume", [
    "pull", image, IMAGE_NAME,
    "--storage", VM_STORAGE,
  ], { stdio: ["ignore", "inherit", "inherit"] });
  const code = await new Promise((resolve, reject) => {
    pull.once("exit", resolve);
    pull.once("error", reject);
  });
  if (code !== 0) throw new Error(`lume pull failed with exit code ${code}`);
  if (!await imageInstalled()) {
    throw new Error(`lume pull completed without creating the ${IMAGE_NAME} VM`);
  }
  await writeFile(referencePath, `${image}\n`);
  return image;
}

async function ensureBaseImageId() {
  const markerPath = join(CIDER_HOME, `${IMAGE_NAME}.image-id`);
  if (await pathExists(markerPath)) {
    const imageId = (await readFile(markerPath, "utf8")).trim();
    if (/^[0-9a-f]{64}$/.test(imageId)) return markerPath;
  }
  process.stdout.write("Identifying the Cider base image for portable snapshots...\n");
  const hash = createHash("sha256");
  const disk = createReadStream(join(VM_STORAGE, IMAGE_NAME, "disk.img"));
  for await (const chunk of disk) hash.update(chunk);
  await writeFile(markerPath, `${hash.digest("hex")}\n`);
  return markerPath;
}

async function nodeMetadata() {
  const [{ stdout: hardwareModel }, { stdout: chip }, { stdout: macosVersion }, { stdout: baseJson }, filesystem] = await Promise.all([
    exec("sysctl", ["-n", "hw.model"]),
    exec("sysctl", ["-n", "machdep.cpu.brand_string"]),
    exec("sw_vers", ["-productVersion"]),
    exec("lume", ["get", IMAGE_NAME, "-f", "json", "--storage", VM_STORAGE]),
    statfs(VM_STORAGE, { bigint: true }),
  ]);
  const baseImages = JSON.parse(baseJson);
  if (!Array.isArray(baseImages) || baseImages.length !== 1) {
    throw new Error(`expected exactly one ${IMAGE_NAME} VM while collecting node metadata`);
  }
  const base = baseImages[0];
  const metadata = {
    hardware_model: hardwareModel.trim(),
    chip: chip.trim(),
    macos_version: macosVersion.trim(),
    cpu_count: cpus().length,
    memory_bytes: totalmem(),
    storage_total_bytes: Number(filesystem.blocks * filesystem.bsize),
    storage_available_bytes: Number(filesystem.bavail * filesystem.bsize),
    default_sandbox_cpu_count: base.cpuCount,
    default_sandbox_memory_bytes: base.memorySize,
    default_sandbox_storage_bytes: base.diskSize?.total,
  };
  for (const [key, value] of Object.entries(metadata)) {
    const minimum = key === "storage_available_bytes" ? 0 : 1;
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < minimum)) {
      throw new Error(`invalid ${key} reported by this Mac`);
    }
    if (typeof value === "string" && !value) {
      throw new Error(`missing ${key} reported by this Mac`);
    }
  }
  return metadata;
}

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

async function startNodeService(command, config, node, baseImageIdPath, imageReference) {
  const password = process.env.CIDER_SSH_PASSWORD
    || (imageReference === DEFAULT_IMAGE ? "lume" : null);
  const child = spawn(command, [], {
    env: {
      ...process.env,
      CIDER_BASE_VM: IMAGE_NAME,
      CIDER_BASE_IMAGE_ID_PATH: baseImageIdPath,
      CIDER_API_URL: config.apiUrl,
      CIDER_NODE_ID: node.id,
      CIDER_NODE_TOKEN: node.token,
      CIDER_NODE_PORT: NODE_PORT,
      CIDER_SSH_KEY: SSH_KEY_PATH,
      CIDER_SSH_USER: SSH_USER,
      CIDER_VM_STORAGE: VM_STORAGE,
      ...(password ? { CIDER_SSH_PASSWORD: password } : {}),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const onSignal = () => {
    stopNodeService(child).finally(() => process.exit(0));
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
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
  const image = options.image || process.env.CIDER_IMAGE || DEFAULT_IMAGE;
  await ensureSshKey();
  const imageReference = await ensureImage({ assumeYes: options.yes, image });
  const baseImageIdPath = await ensureBaseImageId();
  const metadata = await nodeMetadata();
  const node = await enrollment(config, options.name);
  process.stdout.write(`Base VM ready: ${join(VM_STORAGE, IMAGE_NAME)}\n`);
  const nodeCommand = options.nodeCommand || process.env.CIDER_NODE_COMMAND || "cider-node";
  const service = await startNodeService(nodeCommand, config, node, baseImageIdPath, imageReference);
  try {
    await holdConnection(config, node, metadata);
  } finally {
    await stopNodeService(service);
  }
}
