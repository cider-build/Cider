import { readdir } from "node:fs/promises";
import { extname, join, parse } from "node:path";

const COMPONENTS = new URL("../src/components/", import.meta.url);

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    if (entry.isFile()) files.push(path);
  }

  return files;
}

const files = await filesIn(COMPONENTS.pathname);
const components = files.filter((file) => extname(file) === ".tsx");
const errors = [];

for (const component of components) {
  const parsed = parse(component);
  const directory = parse(parsed.dir).base;
  const stylesheet = join(parsed.dir, `${parsed.name}.module.css`);

  if (parsed.name !== directory) {
    errors.push(`${component}: component filename must match its directory`);
  }

  if (!files.includes(stylesheet)) {
    errors.push(`${component}: missing ${parsed.name}.module.css`);
  }
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log(`Checked ${components.length} component files.`);
