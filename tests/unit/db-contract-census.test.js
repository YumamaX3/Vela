// Storage Covenant Wave A2 — the contract census pin.
// Sealed law (plans/storage-covenant.md, Criterion 2, line 200):
//   "Every persistence statement outside repos/sqlite/, migrate.js, backup.js,
//    and the helpers/* sync utilities lives in an async repo function bound
//    through bind.js; getAdapter()/raw SQL appears nowhere else."
//
// A2's job was to absorb keyGate.js (the named violation). This test is the
// ratchet: it pins the CURRENT raw-adapter surface so it can only shrink, never
// grow. src/lib/db/index.js is the ONE staged exception — line 420 of the plan
// books its harbor-home (repos/sqlite/backupRepo.js) for Wave B; it is counted
// here so any SECOND un-harbored consumer fails the gate immediately.
//
// Why "imports getAdapter/driver.js" is the right signal: every supported
// driver (sql.js / better-sqlite3 / node:sqlite / bun:sqlite) is reachable ONLY
// through getAdapter(), so raw SQL cannot exist without importing the adapter.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const SRC = path.join(ROOT, "src");

// Raw-adapter access = importing getAdapter or the driver module.
const ADAPTER_RE = /(getAdapter|from\s+["'][^"']*driver\.js["'])/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

// Sealed exempt set (Criterion 2, line 200) — these legitimately touch the adapter.
const EXEMPT = [
  "src/lib/db/driver.js", // the adapter layer itself
  "src/lib/db/helpers/kvStore.js", // helpers/* sync utility
  "src/lib/db/helpers/metaStore.js", // helpers/* sync utility
  "src/lib/db/backup.js", // sealed exempt (safety-net ATTACH backup)
];
function inHarborOrExempt(file) {
  const r = rel(file);
  if (EXEMPT.includes(r)) return true;
  if (r.startsWith("src/lib/db/repos/sqlite/")) return true; // the harbor
  if (r.startsWith("src/lib/db/repos/mysql/")) return true; // the mysql twin harbor (A7+)
  if (r.startsWith("src/lib/db/mysql/")) return true; // mysql foundation (pool adapter, A6)
  if (r.startsWith("src/lib/db/migrations/")) return true; // migrate machinery
  return false;
}

// The single staged debt: the public barrel still issues raw SQL (exportDb /
// importDb / initDb). Line 420 moves these into repos/sqlite/backupRepo.js;
// A3 rewrites exportDb. Counted at exactly ONE so it cannot silently grow.
const STAGED_DEBT = ["src/lib/db/index.js"];

describe("Storage Covenant A2 — contract census pin", () => {
  const allFiles = walk(SRC);
  const adapterUsers = allFiles.filter((f) => {
    const src = fs.readFileSync(f, "utf-8");
    return ADAPTER_RE.test(src);
  });

  it("no file outside src/lib/db/ touches the raw adapter", () => {
    const outside = adapterUsers.filter((f) => !rel(f).startsWith("src/lib/db/"));
    expect(
      outside.map(rel),
      `Raw adapter access leaked outside src/lib/db/ — ${outside.map(rel).join(", ")}`
    ).toEqual([]);
  });

  it("inside src/lib/db/, adapter users are only the exempt set + the one staged barrel", () => {
    const inside = adapterUsers.filter((f) => rel(f).startsWith("src/lib/db/"));
    const unpermitted = inside.filter((f) => !inHarborOrExempt(f) && !STAGED_DEBT.includes(rel(f)));
    expect(
      unpermitted.map(rel),
      `Unpermitted raw-adapter consumer in src/lib/db/ — ${unpermitted.map(rel).join(", ")}`
    ).toEqual([]);
  });

  it("the staged debt stays at exactly one file (the barrel)", () => {
    const debtPresent = STAGED_DEBT.filter((d) =>
      adapterUsers.some((f) => rel(f) === d)
    );
    // The barrel must still be present (it has not been harbored yet) — and the
    // set of staged-debt files must not have grown beyond the one we named.
    expect(debtPresent).toEqual(STAGED_DEBT);
    const extraDebt = adapterUsers.filter(
      (f) => !rel(f).startsWith("src/lib/db/") || (!inHarborOrExempt(f) && !STAGED_DEBT.includes(rel(f)))
    );
    expect(extraDebt.map(rel)).toEqual([]);
  });

  it("keyGate (the named A2 violation) no longer imports the raw adapter", () => {
    const keyGate = path.join(SRC, "sse/services/keyGate.js");
    const src = fs.readFileSync(keyGate, "utf-8");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db\/driver\.js["']/);
    expect(src).not.toMatch(/getAdapter\(/);
    // It must reach the ledger through the repo seam instead.
    expect(src).toMatch(/from\s+["']@\/lib\/db\/repos\/usageRepo\.js["']/);
  });
});
