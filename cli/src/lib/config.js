import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = join(homedir(), ".cider");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// Defaults match the local dev stack (backend on :8000, dashboard on :3000).
// Override per-shell with CIDER_API_URL / CIDER_WEB_URL when pointing at a
// different deployment.
const DEFAULTS = {
  apiUrl: process.env.CIDER_API_URL || "http://localhost:8000",
  webUrl: process.env.CIDER_WEB_URL || "http://localhost:3000",
};

export async function readConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (err) {
    if (err.code === "ENOENT") return { ...DEFAULTS };
    throw err;
  }
}

export async function writeConfig(next) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const body = JSON.stringify(next, null, 2) + "\n";
  await writeFile(CONFIG_PATH, body, { mode: 0o600 });
  // chmod again in case the file pre-existed with looser perms.
  await chmod(CONFIG_PATH, 0o600);
}

export async function clearConfig() {
  try {
    await rm(CONFIG_PATH);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

export function configPath() {
  return CONFIG_PATH;
}

export function configDir() {
  return CONFIG_DIR;
}

// .cider/sandbox.json next to the user's project dir — analogous to
// `vercel link`'s .vercel/project.json. Lets `cider open` reuse the same
// sandbox across runs from the same directory.
export const SANDBOX_LINK_FILENAME = join(".cider", "sandbox.json");

export async function readSandboxLink(dir) {
  const path = join(dir, SANDBOX_LINK_FILENAME);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeSandboxLink(dir, payload) {
  const path = join(dir, SANDBOX_LINK_FILENAME);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n");
}

export async function clearSandboxLink(dir) {
  const path = join(dir, SANDBOX_LINK_FILENAME);
  try {
    await rm(path);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
