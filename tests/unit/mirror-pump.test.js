// Storage Covenant Wave C3 — the mirror pump exit gate (sqlite leg).
// Plan: plans/storage-covenant.md Wave C ("Pump: seq-ordered single writer;
// applies through the mysql repo impls the parity tests prove; backoff retry;
// boot catch-up drains pending ops; applied rows pruned after 24h") + the
// named test scenarios (line 435: "outage → N writes → outbox N pending →
// catch-up drains; double-delivery → seq-dedupe idempotent; poison-loop →
// createCombo replay with captured identity never hits UNIQUE" — the live
// twin legs of those three ride tests/unit/mirror-pump-live.test.js).
//
// Pinned here against a FAKE twin injected via setMirrorApplier (the seam):
//   1. DRAIN — pending rows apply seq-ordered; applied rows + cursor advance.
//   2. EXEMPT — never applied, terminal 'skipped', honest.
//   3. POISON — a deterministic poison verdict terminals AT ONCE + the
//      backup-ledger alert (mirrorPoison) is written; the head of the line
//      NEVER blocks the rest of the queue.
//   4. RETRY + BACKOFF — infra failures mark 'retry' with attempts counted,
//      one attempt per pass; the budget exhausts → poison + alert.
//   5. S3 — the twin's answer burns the args cargo (redacted sentinel); an
//      outage never journals plaintext (age-out removes rows regardless of
//      status, loudly alerting still-unapplied ops).
//   6. MIGRATION 007 — mirrorSeq cursor table + sqlite-only law + S3 export
//      exclusion; the mysql twin's seq-dedupe DDL is pinned.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c3-"));
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

async function freshDb() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  return db;
}

async function outboxRows() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return (await getAdapter()).all(`SELECT * FROM outbox ORDER BY seq ASC`);
}

async function ledgerRows() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return (await getAdapter()).all(`SELECT * FROM backupLedger ORDER BY createdAt ASC`);
}

/** Seed outbox rows the way the decorator (C2) would. */
async function seedOutbox(entries) {
  const outbox = await import("@/lib/db/repos/sqlite/outboxRepo.js");
  for (const e of entries) await outbox.enqueueOutbox(e);
}

describe("Wave C3 — migration 007 + the sqlite-only law", () => {
  it("a fresh DB migrates to schemaVersion 9 with the mirrorSeq cursor", async () => {
    await freshDb();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    expect(adapter.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`).value).toBe("9");
    const cols = adapter.all(`PRAGMA table_info(mirrorSeq)`).map((r) => r.name).sort();
    expect(cols).toEqual(["id", "lastAppliedSeq", "lastFailedSeq"]);
    // The seed row exists; CHECK keeps it a single-row table.
    expect(adapter.get(`SELECT lastAppliedSeq, lastFailedSeq FROM mirrorSeq WHERE id = 1`))
      .toEqual({ lastAppliedSeq: 0, lastFailedSeq: 0 });
  });

  it("mirrorSeq is NOT in TABLES and IS excluded from every export (S3)", async () => {
    const { TABLES } = await import("@/lib/db/schema.js");
    expect(Object.keys(TABLES)).not.toContain("mirrorSeq");
    expect(Object.keys(TABLES)).not.toContain("outbox");
    const { EXPORT_EXCLUDED_TABLES } = await import("@/lib/db/repos/sqlite/backupRepo.js");
    expect(EXPORT_EXCLUDED_TABLES).toContain("mirrorSeq");
    expect(EXPORT_EXCLUDED_TABLES).toContain("outbox");
    const mysqlTwin = await import("@/lib/db/repos/mysql/backupRepo.js");
    expect(mysqlTwin.EXPORT_EXCLUDED_TABLES).toContain("mirrorSeq"); // twin parity
  });

  it("the twin's seq-dedupe DDL is pinned (double-delivery guard lives ON the twin)", async () => {
    const { mirrorSeqTableDdl } = await import("@/lib/db/repos/mysql/mirrorApplyRepo.js");
    expect(mirrorSeqTableDdl()).toContain("CREATE TABLE IF NOT EXISTS mirrorSeq");
    expect(mirrorSeqTableDdl()).toContain("seq BIGINT PRIMARY KEY");
  });
});

describe("Wave C3 — the drain (seq-ordered single writer)", () => {
  it("outage → N writes → outbox N pending → catch-up drains", async () => {
    await freshDb();
    const { setMirrorApplier, runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");

    // Simulate the outage window: the decorator captured N ops; the twin is dark.
    await seedOutbox([
      { replayClass: "identity-carrying", fnName: "createCombo", args: [{ name: "c1", models: ["m"] }], identity: { id: "u-1", createdAt: "t", updatedAt: "t" } },
      { replayClass: "rmw-stale-hazard", fnName: "updateSettings", args: [{ comboStrategy: "roundrobin" }] },
      { replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["u-9"] },
    ]);
    expect((await outboxRows()).every((r) => r.status === "pending")).toBe(true);

    // The twin returns — boot catch-up drains, preserving seq order.
    const appliedOrder = [];
    setMirrorApplier(async (op) => { appliedOrder.push([op.seq, op.fnName]); return "applied"; });

    const stats = await runMirrorPumpOnce();
    expect(stats.applied).toBe(3);
    expect(stats.drained).toBe(3);
    expect(appliedOrder.map(([, f]) => f)).toEqual(["createCombo", "updateSettings", "deleteCombo"]);
    expect(appliedOrder[0][0]).toBeLessThan(appliedOrder[1][0]); // seq-ordered

    // The cursor advanced to the last applied seq; the journal is burned (S3).
    const { getMirrorCursor } = await import("@/lib/db/repos/sqlite/outboxRepo.js");
    expect((await getMirrorCursor()).lastAppliedSeq).toBe(appliedOrder[2][0]);
    for (const row of await outboxRows()) {
      expect(row.status).toBe("applied");
      expect(row.args).toBe("[REDACTED]");
      expect(row.appliedAt).toBeTruthy();
    }
  });

  it("exempt rows NEVER apply — terminal, honest, audited", async () => {
    await freshDb();
    const { setMirrorApplier, runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    let applied = 0;
    setMirrorApplier(async () => { applied++; return "applied"; });
    await seedOutbox([
      { replayClass: "exempt", fnName: "saveRequestUsage", args: [{ tokens: 100, secretToken: "sk-live-x" }] },
    ]);

    const stats = await runMirrorPumpOnce();
    expect(applied).toBe(0); // exempt never touches the twin
    expect(stats.skipped).toBe(1);
    const [row] = await outboxRows();
    expect(row.status).toBe("skipped");
    expect(row.error).toContain("exempt");
    expect(row.args).toBe("[REDACTED]"); // usage cargo burned too
  });

  it("a deterministic poison terminals AT ONCE + ledger alert; the queue head never blocks", async () => {
    await freshDb();
    const { setMirrorApplier, runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    setMirrorApplier(async (op) => (op.fnName === "createCombo" ? "poison" : "applied"));
    await seedOutbox([
      { replayClass: "identity-carrying", fnName: "createCombo", args: [{ name: "p" }], identity: { id: "u-p" } },
      { replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["x"] }, // MUST still apply
    ]);

    const stats = await runMirrorPumpOnce();
    expect(stats.poisoned).toBe(1);
    expect(stats.applied).toBe(1); // the poison did NOT head-of-line-block
    const rows = await outboxRows();
    expect(rows[0].status).toBe("failed");
    expect(rows[0].retries).toBe(1); // terminal at once — no retry churn
    expect(rows[1].status).toBe("applied");

    // The ledger alert surfaces the poison for manual replay.
    const ledger = await ledgerRows();
    const alert = ledger.find((r) => r.kind === "mirrorPoison");
    expect(alert).toBeTruthy();
    expect(alert.status).toBe("failed");
    expect(alert.error).toBeTruthy();
    const meta = JSON.parse(alert.meta);
    expect(meta.fnName).toBe("createCombo");
  });
});

describe("Wave C3 — retry, budget, backoff posture", () => {
  it("infra failures count one attempt per pass; budget exhaustion poisons + alerts", async () => {
    await freshDb();
    const { setMirrorApplier, runMirrorPumpOnce, getMirrorPumpStatus, startMirrorPump, stopMirrorPump } =
      await import("@/lib/db/mirror/mirrorPump.js");
    await seedOutbox([
      { replayClass: "rmw-stale-hazard", fnName: "updateSettings", args: [{ a: 1 }] },
    ]);

    // The twin stays dark for the first passes — args must SURVIVE (recovery cargo).
    setMirrorApplier(async () => { throw new Error("ECONNREFUSED 192.0.2.1:3306"); });
    let stats = await runMirrorPumpOnce({ maxRetries: 2 });
    expect(stats.retried).toBe(1);
    let [row] = await outboxRows();
    expect(row.status).toBe("retry");
    expect(row.retries).toBe(1);
    expect(row.args).not.toBe("[REDACTED]"); // outage window keeps its cargo

    // Pass two burns the final attempt → poison + alert + cargo burned.
    stats = await runMirrorPumpOnce({ maxRetries: 2 });
    expect(stats.poisoned).toBe(1);
    [row] = await outboxRows();
    expect(row.status).toBe("failed");
    expect(row.args).toBe("[REDACTED]");
    expect((await ledgerRows()).some((r) => r.kind === "mirrorPoison")).toBe(true);

    // Backoff posture: a degraded run raises the next delay above the healthy tick.
    stopMirrorPump();
    startMirrorPump({ tickMs: 60_000 }); // lifecycle only — stop immediately
    stopMirrorPump();
    const status = getMirrorPumpStatus();
    expect(status.nextDelayMs).toBeGreaterThanOrEqual(60_000);
    expect(status.running).toBe(false);
  });

  it("a single pass never re-attempts a row (seen-set: no budget burn inside one drain)", async () => {
    await freshDb();
    const { setMirrorApplier, runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    let attempts = 0;
    setMirrorApplier(async () => { attempts++; throw new Error("dark twin"); });
    await seedOutbox([
      { replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["a"] },
      { replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["b"] },
    ]);
    await runMirrorPumpOnce({ maxRetries: 5 });
    expect(attempts).toBe(2); // exactly one attempt per row this pass
    const rows = await outboxRows();
    expect(rows.every((r) => r.status === "retry" && r.retries === 1)).toBe(true);
  });
});

describe("Wave C3 — S3 retention + age-out", () => {
  it("applied rows prune after 24h; still-unapplied ops age out WITH a loud alert", async () => {
    await freshDb();
    const { setMirrorApplier, runMirrorPumpOnce } = await import("@/lib/db/mirror/mirrorPump.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();

    // The 24h applied-prune: apply a row, backdate appliedAt, drain again.
    setMirrorApplier(async () => "applied");
    await seedOutbox([
      { replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["fresh"] },
    ]);
    await runMirrorPumpOnce();
    adapter.run(`UPDATE outbox SET appliedAt = '2020-01-01T00:00:00.000Z'`);
    let stats = await runMirrorPumpOnce();
    expect(stats.pruned).toBe(1); // the aged applied row left silently

    // The S3 age-out: a RETRY row older than the window leaves the journal —
    // loudly, because it is a lost replication.
    setMirrorApplier(async () => { throw new Error("dark twin"); });
    await seedOutbox([
      { replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["stuck"] },
    ]);
    await runMirrorPumpOnce(); // attempt 1 → retries=1, cargo intact
    adapter.run(`UPDATE outbox SET createdAt = '2020-01-01T00:00:00.000Z' WHERE status = 'retry'`);
    stats = await runMirrorPumpOnce(); // attempt 2 → retry, then the window prune takes it
    expect(stats.retried).toBe(1);
    expect((await outboxRows()).length).toBe(0); // aged out regardless of status
    const ledger = await ledgerRows();
    expect(ledger.some((r) => r.kind === "mirrorAgeOut" && r.status === "failed")).toBe(true);
  });
});

describe("Wave C3 — lifecycle (backupScheduler precedent)", () => {
  it("start/stop/configure/status — one pump, boot catch-up fires immediately", async () => {
    await freshDb();
    const { startMirrorPump, stopMirrorPump, configureMirrorPump, getMirrorPumpStatus, setMirrorApplier } =
      await import("@/lib/db/mirror/mirrorPump.js");
    setMirrorApplier(async () => "applied");
    await seedOutbox([
      { replayClass: "idempotent-upsert", fnName: "deleteCombo", args: ["boot"] },
    ]);

    const state = startMirrorPump({ tickMs: 60_000 });
    expect(state).toBeTruthy();
    expect(startMirrorPump({ tickMs: 60_000 })).toBe(state); // idempotent — single writer
    await new Promise((r) => setTimeout(r, 150)); // boot catch-up runs async

    const status = getMirrorPumpStatus();
    expect(status.running).toBe(true);
    expect(status.lastResult?.applied).toBe(1); // boot catch-up drained the backlog
    expect(status.degraded).toBe(false);

    stopMirrorPump();
    expect(getMirrorPumpStatus().running).toBe(false);
    configureMirrorPump({ tickMs: 999 });
    expect(getMirrorPumpStatus().nextDelayMs).toBe(999);
  });
});
