// GHOST-SLOT REPAIR — a version number is a claim; the tables are the proof.
//
// THE DEFECT THIS SUITE EXISTS FOR: the live harbor's `_meta.schemaVersion`
// already read 20 from an earlier build before migration 020 was written. The
// runner short-circuits on `current >= target`, so the guardrail DDL would
// never run and the policy routes would answer 500 against a version number
// that claimed the tables existed. The repair verifies a migration's declared
// tables and re-applies an idempotent `up()` when they are missing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

let tempDir;
let driver;
let file;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-ghost-slot-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  driver = await import("@/lib/db/driver.js");
  fs.mkdirSync(path.join(tempDir, "db"), { recursive: true });
  file = path.join(tempDir, "db", "data.sqlite");
});

afterAll(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

function tableNames(adapter) {
  return adapter
    .all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'guardrail%'")
    .map((r) => r.name)
    .sort();
}

describe("migration ghost-slot repair", () => {
  it("re-applies a migration whose declared tables are missing while the version already matches", async () => {
    const first = await driver.getScratchAdapter(file);
    expect(tableNames(first)).toEqual(["guardrailLogs", "guardrailPolicies"]);

    // Simulate the live harbor: the slot is stamped, the structure is absent.
    first.exec("DROP TABLE IF EXISTS guardrailLogs");
    first.exec("DROP TABLE IF EXISTS guardrailPolicies");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    first.exec(`UPDATE _meta SET value = '${latestVersion()}' WHERE key = 'schemaVersion'`);
    expect(tableNames(first)).toEqual([]);
    first.close();

    const second = await driver.getScratchAdapter(file);
    try {
      expect(tableNames(second)).toEqual(["guardrailLogs", "guardrailPolicies"]);
      const version = second.get("SELECT value FROM _meta WHERE key = 'schemaVersion'");
      expect(version.value).toBe(String(latestVersion()));
      // The repair must not spend a new version: the number was already taken.
    } finally {
      second.close();
    }
  });

  it("is a no-op on a harbor whose tables already exist", async () => {
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const adapter = await driver.getScratchAdapter(file);
    try {
      expect(tableNames(adapter)).toEqual(["guardrailLogs", "guardrailPolicies"]);
      const version = adapter.get("SELECT value FROM _meta WHERE key = 'schemaVersion'");
      expect(version.value).toBe(String(latestVersion()));
    } finally {
      adapter.close();
    }
  });
});
