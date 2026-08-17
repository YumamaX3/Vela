// Storage Covenant Wave C1 — the outbox + replay-class registry exit gate.
// Plan: plans/storage-covenant.md Wave C (outbox op-log + replay-class
// taxonomy, binding law). Pinned here:
//   1. A fresh DB migrates to schemaVersion 9 with the outbox table (full
//      column census) — migration 006 (007 adds the pump's mirrorSeq cursor).
//   2. SQLITE-ONLY LAW: outbox is NOT in TABLES — syncSchemaFromTables/
//      mysql bootstrap must never replicate the pump's op-log onto the twin.
//   3. S3: EXPORT_EXCLUDED_TABLES names outbox (sealed in B2, re-asserted
//      now that the table exists).
//   4. The outboxRepo seam round-trips: enqueue → fetch pending (seq order) →
//      applied/poison verdicts.
//   5. The replay registry is COMPLETE + HONEST: every classified name is a
//      real barrel export, every value is a legal class, and the
//      identity-carrying set pins the capture contract exactly.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c1-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.MODE = process.env.VELA_DB_MODE;
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const OUTBOX_COLUMNS = [
  "seq", "replayClass", "fnName", "args", "identity",
  "status", "retries", "error", "createdAt", "appliedAt",
];

describe("Wave C1 — migration 006 + the sqlite-only law", () => {
  it("a fresh DB migrates to schemaVersion 9 with the outbox table", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    expect(adapter.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`).value).toBe("9");
    const cols = adapter.all(`PRAGMA table_info(outbox)`).map((r) => r.name).sort();
    expect(cols).toEqual([...OUTBOX_COLUMNS].sort());
    // AUTOINCREMENT on seq — sqlite_sequence proves it.
    adapter.run(`INSERT INTO outbox(replayClass, fnName, args, createdAt) VALUES('idempotent-upsert', 'x', '[]', '2026-08-16T00:00:00.000Z')`);
    expect(adapter.get(`SELECT seq FROM sqlite_sequence WHERE name = 'outbox'`).seq).toBe(1);
  });

  it("outbox is NOT in TABLES — the mysql bootstrap never replicates it", async () => {
    const { TABLES } = await import("@/lib/db/schema.js");
    expect(Object.keys(TABLES)).not.toContain("outbox");
    expect(Object.keys(TABLES)).toContain("backupLedger"); // the ledger IS replicated
  });

  it("S3 — EXPORT_EXCLUDED_TABLES still names outbox", async () => {
    const { EXPORT_EXCLUDED_TABLES } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    expect(EXPORT_EXCLUDED_TABLES).toContain("outbox");
    expect(EXPORT_EXCLUDED_TABLES).toContain("backupLedger");
  });
});

describe("Wave C1 — the outboxRepo seam", () => {
  it("enqueue → fetch pending (seq order) → applied/poison verdicts", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const outbox = await import("@/lib/db/repos/sqlite/outboxRepo.js");

    await outbox.enqueueOutbox({ replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["c-1"] });
    await outbox.enqueueOutbox({ replayClass: "identity-carrying", fnName: "createCombo", args: [{ name: "n" }], identity: { id: "uuid-x" } });

    const pending = await outbox.fetchPendingOutbox();
    expect(pending.length).toBe(2);
    expect(pending[0].seq).toBeLessThan(pending[1].seq); // seq-ordered
    expect(pending[0].fnName).toBe("deleteCombo");
    expect(JSON.parse(pending[0].args)).toEqual(["c-1"]);
    expect(pending[0].status).toBe("pending");
    expect(JSON.parse(pending[1].identity)).toEqual({ id: "uuid-x" });

    await outbox.markOutboxApplied(pending[0].seq);
    await outbox.markOutboxPoison(pending[1].seq, "ER_DUP_ENTRY", 5);
    const after = await outbox.fetchPendingOutbox();
    expect(after.length).toBe(0); // applied gone; poison is terminal, not retryable
  });

  it("markOutboxFailed keeps the row retryable; prune clears old applied rows", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const outbox = await import("@/lib/db/repos/sqlite/outboxRepo.js");
    await outbox.enqueueOutbox({ replayClass: "rmw-stale-hazard", fnName: "updateSettings", args: [{}] });
    const [row] = await outbox.fetchPendingOutbox();
    await outbox.markOutboxFailed(row.seq, "ECONNREFUSED", 1);
    const retryable = await outbox.fetchPendingOutbox();
    expect(retryable.length).toBe(1); // 'retry' rows come back
    expect(retryable[0].error).toContain("ECONNREFUSED");

    // Prune: mark applied with an ancient appliedAt, then prune at 24h.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    adapter.run(`UPDATE outbox SET status = 'applied', appliedAt = '2020-01-01T00:00:00.000Z' WHERE seq = ?`, [row.seq]);
    const { pruned } = await outbox.pruneAppliedOutbox();
    expect(pruned).toBe(1);
  });
});

describe("Wave C1 — the replay registry is binding law", () => {
  it("every classified name is a real facade-surface export; every class is legal", async () => {
    const { REPLAY_CLASSES, REPLAY_CLASS, classifyWriter } = await import("@/lib/db/mirror/replayRegistry.js");
    // The decorator wraps the FACADE surface (bind.js wave names), not only the
    // main barrel — touchKeyLastUsed/ensureInternalKey live on repo facades.
    const barrel = await import("@/lib/db/index.js");
    const usageFacade = await import("@/lib/db/repos/usageRepo.js");
    const apiKeysFacade = await import("@/lib/db/repos/apiKeysRepo.js");
    const surface = { ...barrel, ...usageFacade, ...apiKeysFacade };
    const classes = new Set(Object.values(REPLAY_CLASS));
    for (const [name, cls] of Object.entries(REPLAY_CLASSES)) {
      expect(classes.has(cls), `class "${cls}" for ${name} is not one of the four`).toBe(true);
      expect(typeof surface[name], `"${name}" is classified but not on the facade surface`).toBe("function");
    }
    // Reads and unknowns classify to null — the decorator never captures them.
    expect(classifyWriter("getSettings")).toBeNull();
    expect(classifyWriter("definitelyNotAWriter")).toBeNull();
  });

  it("the identity-carrying set pins the capture contract exactly", async () => {
    const { REPLAY_CLASSES, REPLAY_CLASS, classifyWriter } = await import("@/lib/db/mirror/replayRegistry.js");
    const identityCarrying = Object.entries(REPLAY_CLASSES)
      .filter(([, c]) => c === REPLAY_CLASS.IDENTITY_CARRYING)
      .map(([n]) => n)
      .sort();
    // The six creators whose generated identity must ride the outbox row —
    // replaying them without capture mints new uuids → UNIQUE poison loops.
    expect(identityCarrying).toEqual([
      "createApiKey", "createCombo", "createProviderConnection",
      "createProviderNode", "createProxyPool", "ensureInternalKey",
    ]);
    expect(classifyWriter("createCombo")).toBe(REPLAY_CLASS.IDENTITY_CARRYING);
  });

  it("the exempt set names exactly the unmirrable writers", async () => {
    const { REPLAY_CLASSES, REPLAY_CLASS } = await import("@/lib/db/mirror/replayRegistry.js");
    const exempt = Object.entries(REPLAY_CLASSES)
      .filter(([, c]) => c === REPLAY_CLASS.EXEMPT)
      .map(([n]) => n)
      .sort();
    expect(exempt).toEqual(["appendRequestLog", "saveRequestDetail", "saveRequestUsage"]);
  });
});
