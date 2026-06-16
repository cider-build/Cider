#!/usr/bin/env node
import { run } from "../src/index.js";

run(process.argv).catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  process.stderr.write(`cider: ${msg}\n`);
  process.exit(1);
});
