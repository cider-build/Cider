import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CIDER_HOME = process.env.CIDER_HOME || join(homedir(), ".cider");
const CONFIG_PATH = join(CIDER_HOME, "config.json");
export const NODE_PORT = process.env.CIDER_NODE_PORT || "8001";
export const NODE_URL = process.env.CIDER_NODE_URL || `http://127.0.0.1:${NODE_PORT}`;

function parseJson(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value;
}

export function readConfig() {
  const file = existsSync(CONFIG_PATH) ? parseJson(CONFIG_PATH) : {};
  const apiUrl = process.env.CIDER_API_URL || file.apiUrl;
  if (!apiUrl) {
    throw new Error("CIDER_API_URL must be set before the first Cider login");
  }
  return {
    apiUrl,
    token: process.env.CIDER_TOKEN || file.token,
  };
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function writeConfig(config) {
  return writePrivateJson(CONFIG_PATH, config);
}

function nodeStatePath() {
  return join(CIDER_HOME, "node.json");
}

export function readNodeState() {
  const path = nodeStatePath();
  return existsSync(path) ? parseJson(path) : null;
}

export function writeNodeState(state) {
  return writePrivateJson(nodeStatePath(), state);
}
