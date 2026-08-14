#!/usr/bin/env node
// Regenerate the ACL enforcement-site census baseline.
// Usage: node tests/__baseline__/snapshot-apikey-enforcement.mjs
// Run from repo root after intentionally adding/removing a /v1 enforcement site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const SRC = path.join(repoRoot, "src");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const sites = [];
for (const file of walk(SRC)) {
  const rel = path.relative(repoRoot, file).split(path.sep).join("/");
  if (rel === "src/sse/services/keyGate.js") continue;
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("authorizeApiRequest(")) continue;
  const callLine = text.split("\n").find((l) => l.includes("authorizeApiRequest(request"));
  sites.push({
    file: rel,
    allowInternal: /allowInternal:\s*true/.test(callLine || ""),
    comboModels: /comboModels:/.test(callLine || ""),
  });
}
sites.sort((a, b) => a.file.localeCompare(b.file));

const out = {
  description:
    "ACL enforcement-site census — tripwire for plans/vela-key-governance.md §3.5. Every /v1 entry that must pass the key gate. Regenerate with: node tests/__baseline__/snapshot-apikey-enforcement.mjs",
  sites,
};
fs.writeFileSync(path.join(__dirname, "apikey-enforcement-sites.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`✅ Baseline updated: ${sites.length} enforcement sites`);
