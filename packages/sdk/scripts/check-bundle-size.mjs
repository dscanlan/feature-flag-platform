#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../dist");
const LIMIT = 15 * 1024; // 15 KB gzipped

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Prefer the ESM client bundle — that's what the browser will load.
  const candidates = ["client.js", "client.mjs"];
  let target = null;
  for (const name of candidates) {
    const full = path.join(distDir, name);
    if (await exists(full)) {
      target = full;
      break;
    }
  }
  if (!target) {
    console.error(`bundle-size: no client bundle found in ${distDir}`);
    process.exit(1);
  }
  const buf = await readFile(target);
  const gz = gzipSync(buf);
  const raw = buf.byteLength;
  const gzippedKb = (gz.byteLength / 1024).toFixed(2);
  console.log(
    `bundle: ${path.basename(target)} — ${raw} B raw, ${gz.byteLength} B gzipped (${gzippedKb} KB)`,
  );
  if (gz.byteLength > LIMIT) {
    console.error(`bundle-size: client bundle ${gz.byteLength} B exceeds ${LIMIT} B (15 KB gz)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
