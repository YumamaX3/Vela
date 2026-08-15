// Storage Covenant Wave A10 — the contract surface pin guardian.
// Plan line 275: "contract surface pin baseline (tests/__baseline__/)".
//
// contract-surface.json froze the barrel's exact export surface at Wave A's
// seal (74 symbols: 64 parity-registered + 10 exempt-process + 0 pending).
// This script re-derives the surface from the live barrel — statically, by
// parsing src/lib/db/index.js's `export { … } from "./repos/X.js"` blocks
// plus its own function exports (exportDb/importDb/initDb) — and fails LOUD
// on any divergence: a silently grown or shrunk contract surface is the
// first symptom of parity coverage erosion.
//
// Runs under plain `node` (Linux CI + Windows alike) — vitest not required.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");

const snapPath = join(here, "contract-surface.json");
const snapshot = JSON.parse(readFileSync(snapPath, "utf-8"));

const barrelSrc = readFileSync(join(ROOT, "src", "lib", "db", "index.js"), "utf-8");
const live = new Set();

// Named re-export blocks: export { a, b, c } from "./repos/X.js";
for (const m of barrelSrc.matchAll(/export\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/gs)) {
  for (const part of m[1].split(",")) {
    const name = part.trim().split(/\s+as\s+/).pop().trim(); // honor `X as Y`
    if (name) live.add(name);
  }
}

// The barrel's own exports: export (async) function NAME / export const NAME
for (const m of barrelSrc.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) live.add(m[1]);
for (const m of barrelSrc.matchAll(/^export\s+const\s+(\w+)/gm)) live.add(m[1]);

const pinned = new Set(snapshot.exports);
const missing = [...pinned].filter((n) => !live.has(n)).sort();
const added = [...live].filter((n) => !pinned.has(n)).sort();

if (missing.length || added.length || live.size !== snapshot.total) {
  console.error("[verify-contract-surface] CONTRACT SURFACE DIVERGED from the A10 pin:");
  if (missing.length) console.error("  removed since A10:", missing.join(", "));
  if (added.length) console.error("  added since A10:", added.join(", "));
  console.error(`  pinned total: ${snapshot.total} | live total: ${live.size}`);
  console.error("  If this change is deliberate (Wave B harbors exportDb/importDb, a new");
  console.error("  repo lands), re-pin consciously — never silently.");
  process.exit(1);
}

console.log(`[verify-contract-surface] OK — ${snapshot.total} symbols (parity ${snapshot.parity} + exempt-process ${snapshot.exemptProcess} + pending ${snapshot.exemptPending})`);
