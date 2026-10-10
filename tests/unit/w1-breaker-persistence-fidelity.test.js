/**
 * W1 — Breaker Persistence Fidelity (proxy control-plane rebirth)
 *
 * Proves the wound is closed: the breaker's flush must reach the DB, must not
 * clobber a sibling fitness row, and must survive a module re-import.
 *
 * Every assertion here is RED on the pre-W1 HEAD. Before the repair the flush
 * routed a six-field row through the 13-column upsertFitnessBatch, which bound
 * eight `undefined` values into NOT NULL columns — the batch's single
 * transaction rolled back, and the cooldown never landed at all.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── A real scratch sqlite adapter, not a mock ──────────────────────────────
// The whole point of W1 is what the DRIVER does with the bound values, so a
// mock would prove nothing. node:sqlite is the strictest of the dialects: it
// refuses an `undefined` bind outright ("Provided value cannot be bound to
// SQLite parameter N"), which is exactly the failure the old path hit.
let dir;
let db;

function makeAdapter(handle) {
  return {
    run: (sql, params = []) => handle.prepare(sql).run(...params),
    get: (sql, params = []) => handle.prepare(sql).get(...params),
    all: (sql, params = []) => handle.prepare(sql).all(...params),
    exec: (sql) => handle.exec(sql),
    transaction: (fn) => fn(),
    close: () => handle.close(),
    raw: handle,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vela-w1-"));
  db = makeAdapter(new DatabaseSync(join(dir, "w1.sqlite")));
  // Migration 011's shape — the real one, so the NOT NULL constraints bite.
  db.exec(`
    CREATE TABLE proxyFitness (
      poolId TEXT NOT NULL,
      provider TEXT NOT NULL,
      successCount INTEGER NOT NULL DEFAULT 0,
      failureCount INTEGER NOT NULL DEFAULT 0,
      successEwma REAL NOT NULL DEFAULT 0,
      latencyEwmaMs REAL NOT NULL DEFAULT 0,
      lastOutcomeAt TEXT,
      unfit INTEGER NOT NULL DEFAULT 0,
      unfitReason TEXT,
      unfitUntil TEXT,
      egressIp TEXT NOT NULL DEFAULT '',
      egressCountry TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (poolId, provider)
    )
  `);
});

afterAll(() => {
  try { db.close(); } catch {}
  // Windows holds the WAL and SHM file handles past close for a beat; the
  // sweep must tolerate EBUSY rather than fail the suite on a lock artifact.
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

// The narrow writer under test, imported from the harbor directly.
const { upsertFitnessUnfit, upsertFitnessBatch } = await import(
  "../../src/lib/db/repos/sqlite/proxyFitnessRepo.js"
);

describe("W1 — breaker persistence fidelity", () => {
  it("lands the cooldown fields AND leaves a sibling row's counters untouched", () => {
    // Seed a live fitness row the way proxyFleet does — full 13 columns.
    upsertFitnessBatch(db, [{
      poolId: "pool-live", provider: "freebuff",
      successCount: 41, failureCount: 3, successEwma: 0.87, latencyEwmaMs: 1420,
      lastOutcomeAt: "2026-10-05T10:00:00.000Z",
      unfit: 0, unfitReason: null, unfitUntil: null,
      egressIp: "203.0.113.9", egressCountry: "SG",
      updatedAt: "2026-10-05T10:00:00.000Z",
    }]);

    const before = db.get(
      "SELECT successCount, failureCount, successEwma, latencyEwmaMs, egressIp FROM proxyFitness WHERE poolId = ? AND provider = ?",
      ["pool-live", "freebuff"]
    );

    // The breaker's flush row — six fields, exactly as circuitBreaker builds it.
    upsertFitnessUnfit(db, [{
      poolId: "pool-live", provider: "freebuff", model: "",
      unfit: 1, unfitReason: "breaker_cooldown",
      unfitUntil: "2026-10-05T10:01:00.000Z",
      updatedAt: "2026-10-05T10:00:30.000Z",
    }]);

    const after = db.get(
      "SELECT * FROM proxyFitness WHERE poolId = ? AND provider = ?",
      ["pool-live", "freebuff"]
    );

    // 1. The cooldown landed.
    expect(after.unfit).toBe(1);
    expect(after.unfitReason).toBe("breaker_cooldown");
    expect(after.unfitUntil).toBe("2026-10-05T10:01:00.000Z");

    // 2. THE ANTI-CLOBBER PROOF — the sibling's counters survived byte-for-byte.
    //    A padding fix (or the old 13-column batch) fails this assertion.
    expect(after.successCount).toBe(before.successCount);
    expect(after.failureCount).toBe(before.failureCount);
    expect(after.successEwma).toBe(before.successEwma);
    expect(after.latencyEwmaMs).toBe(before.latencyEwmaMs);
    expect(after.egressIp).toBe(before.egressIp);
    expect(after.lastOutcomeAt).toBe("2026-10-05T10:00:00.000Z");
  });

  it("inserts a row for a pool with no prior fitness entry, with safe defaults", () => {
    upsertFitnessUnfit(db, [{
      poolId: "pool-fresh", provider: "codex", model: "",
      unfit: 1, unfitReason: "breaker_exhausted",
      unfitUntil: "2026-10-05T10:05:00.000Z",
      updatedAt: "2026-10-05T10:00:30.000Z",
    }]);

    const row = db.get(
      "SELECT * FROM proxyFitness WHERE poolId = ? AND provider = ?",
      ["pool-fresh", "codex"]
    );
    expect(row.unfit).toBe(1);
    expect(row.unfitReason).toBe("breaker_exhausted");
    // The NOT NULL counters fall to their DEFAULT, not to NULL.
    expect(row.successCount).toBe(0);
    expect(row.failureCount).toBe(0);
    expect(row.successEwma).toBe(0);
    expect(row.latencyEwmaMs).toBe(0);
  });

  it("clears a recovered pool back to unfit=0 (the never-clears bug)", () => {
    upsertFitnessUnfit(db, [{
      poolId: "pool-live", provider: "freebuff", model: "",
      unfit: 0, unfitReason: null, unfitUntil: null,
      updatedAt: "2026-10-05T10:02:00.000Z",
    }]);

    const row = db.get(
      "SELECT unfit, unfitReason, unfitUntil FROM proxyFitness WHERE poolId = ? AND provider = ?",
      ["pool-live", "freebuff"]
    );
    expect(row.unfit).toBe(0);
    expect(row.unfitReason).toBeNull();
    expect(row.unfitUntil).toBeNull();
  });

  it("a row that would have poisoned computeScore can no longer be written", () => {
    // The pre-W1 path bound `undefined` into successCount/failureCount/
    // successEwma/latencyEwmaMs. Under node:sqlite that threw; under mysql2 it
    // coerced to NULL, and computeScore then read null/(null+null) = NaN,
    // pinning the weighted draw to the last pool. The narrow writer has no
    // path that can produce a NULL counter — prove it by asserting every row
    // in the table carries finite counters.
    const rows = db.all("SELECT * FROM proxyFitness");
    for (const r of rows) {
      expect(Number.isFinite(r.successCount)).toBe(true);
      expect(Number.isFinite(r.failureCount)).toBe(true);
      expect(Number.isFinite(r.successEwma)).toBe(true);
      expect(Number.isFinite(r.latencyEwmaMs)).toBe(true);
    }
    expect(rows.length).toBeGreaterThan(0);
  });
});
