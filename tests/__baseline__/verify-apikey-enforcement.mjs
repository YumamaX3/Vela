#!/usr/bin/env node
// Verify the ACL enforcement-site census against the committed baseline.
// Usage: node tests/__baseline__/verify-apikey-enforcement.mjs
// Exit 0 = no drift; exit 1 = drift detected (a /v1 enforcement site moved,
// changed its allowInternal/comboModels flags, or went missing).
// If the change is intentional: node tests/__baseline__/snapshot-apikey-enforcement.mjs
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

const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "apikey-enforcement-sites.json"), "utf8"));
const baseMap = new Map(baseline.sites.map((s) => [s.file, s]));

const current = [];
for (const file of walk(SRC)) {
  const rel = path.relative(repoRoot, file).split(path.sep).join("/");
  if (rel === "src/sse/services/keyGate.js") continue;
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("authorizeApiRequest(")) continue;
  const callLine = text.split("\n").find((l) => l.includes("authorizeApiRequest(request"));
  current.push({
    file: rel,
    allowInternal: /allowInternal:\s*true/.test(callLine || ""),
    comboModels: /comboModels:/.test(callLine || ""),
  });
}

const problems = [];
const seen = new Set();
for (const site of current) {
  seen.add(site.file);
  const base = baseMap.get(site.file);
  if (!base) {
    problems.push(`NEW site not in baseline: ${site.file}`);
    continue;
  }
  if (base.allowInternal !== site.allowInternal) {
    problems.push(`${site.file}: allowInternal drifted ${base.allowInternal} → ${site.allowInternal}`);
  }
  if (base.comboModels !== site.comboModels) {
    problems.push(`${site.file}: comboModels drifted ${base.comboModels} → ${site.comboModels}`);
  }
}
for (const [file] of baseMap) {
  if (!seen.has(file)) problems.push(`MISSING site (removed from code): ${file}`);
}

if (problems.length) {
  console.error("❌ ACL enforcement-site drift detected:");
  for (const p of problems) console.error(`   - ${p}`);
  console.error("If intentional, regenerate: node tests/__baseline__/snapshot-apikey-enforcement.mjs");
  process.exit(1);
}
console.log(`✅ ACL census holds: ${current.length} enforcement sites match the baseline`);
