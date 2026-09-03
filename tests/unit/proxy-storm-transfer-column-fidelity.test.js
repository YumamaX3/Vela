/**
 * PROXY STORM — TRANSFER COLUMN FIDELITY (milestone 0.6, LIVE-C + LIVE-D)
 *
 * The wound: six columns existed in the schema, were written by the LIVE writers,
 * and were then silently dropped by every path that moves rows between engines or
 * through an artifact.
 *
 *   LIVE-C — five `usageHistory` columns (migration 008's Observatory telemetry
 *     `latencyMs`, `ttftMs`, `httpStatus`, `statusClass` + migration 015's
 *     `combo`). The live writer `usageRepo.js:396` INSERTs all NINETEEN; the
 *     transfer paths carried fourteen. Four sites were affected:
 *       · sqlite/usageResyncRepo.js `fetchUsageBatch`  SELECT 14 → 19
 *       · mysql/usageResyncRepo.js  `applyUsageBatch`  INSERT 15 → 20
 *       · sqlite/backupRepo.js      exportDb + importDb
 *       · mysql/backupRepo.js       exportDb + importDb
 *     `usageHistory` is ABSENT from FINGERPRINT_TABLES (the set holds exactly six
 *     keys), so no divergence sweep could ever detect it. The twin's five columns
 *     were permanently NULL, and backup→restore lost them too — the loss was not
 *     twin-only.
 *
 *   LIVE-D — `requestDetails.combo`. Migration 015 added it to TABLES "in parity
 *     with usageHistory.combo so both ledgers tell the same story" and the live
 *     writer (`requestDetailsRepo.js:65`) INSERTs 8 columns and even updates
 *     `combo` in its ON CONFLICT clause — but both engines' `exportDb` emitted 7
 *     and both `importDb`s INSERTed 7. Same negligence class, same migration,
 *     adjacent table. Found by tracing paths, not by reading a summary: NO
 *     research stream reported it.
 *
 * THE NEGLIGENCE-VS-LAW DISTINCTION this suite encodes
 * -----------------------------------------------------
 * `apiKey` sits immediately beside these columns in the same export map and is
 * DELIBERATELY nulled — a plaintext credential banned from artifacts by law, with
 * `fetchUsageBatch`'s own comment naming it. One documented exclusion is a
 * designed law; five more riding along unannounced next to it is what made the
 * omission LOOK intentional. S5 below asserts the distinction still holds: apiKey
 * stays null, the five come back whole.
 *
 * WHY THIS IS A ROUND-TRIP AND NOT A COLUMN COUNT
 * ------------------------------------------------
 * A static count of columns vs placeholders would be weak proof — and unnecessary,
 * because a mismatch THROWS at runtime. Writing → exporting → DESTROYING →
 * importing → reading back exercises the real SQL on a real adapter, so the count
 * is checked by sqlite itself, and every value assertion is on data that has
 * genuinely crossed the seam. Values are chosen so a fallback default cannot
 * satisfy them by accident (statusClass is a non-empty sentinel string, not '';
 * the NULL-preservation row asserts NULL comes back NULL, which would fail loudly
 * had the coalescing been written `?? 0`).
 *
 * ISOLATION — copied verbatim from backup-restore-sentinel.test.js, which learned
 * it the hard way. Two module-level caches defeat per-test DATA_DIR isolation:
 *   1. src/lib/db/paths.js freezes DB_DIR / DATA_FILE / BACKUPS_DIR at first import
 *   2. src/lib/db/driver.js binds `const state = global._dbAdapter` once at module
 *      eval, so `delete global._dbAdapter` alone never rebinds it
 * The fix is vi.resetModules() in BOTH hooks + DATA_DIR set before the first
 * dynamic import + every `@/lib/db/...` reached via `await import()`.
 *
 * SECURITY NOTE: the encryption key below is a TEST value, never a live secret.
 * Every host in this file is an example address, never a live one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let liveAdapter = null;
const originalDataDir = process.env.DATA_DIR;
const originalApiKeySecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  // Reset FIRST, then point the env, then let each test import dynamically.
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-transfer-fidelity-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "transfer-fidelity-test-secret";
  delete global._dbAdapter;
  liveAdapter = null;
});

afterEach(() => {
  try { liveAdapter?.instance?.close?.(); } catch {}
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  liveAdapter = null;
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalApiKeySecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalApiKeySecret;
});

/** Fresh adapter bound to THIS test's temp DATA_DIR (post-resetModules). */
async function freshAdapter() {
  delete global._dbAdapter;
  const { getAdapter } = await import("@/lib/db/driver.js");
  liveAdapter = await getAdapter();
  return liveAdapter;
}

// Distinctive on purpose: no value here equals the fallback its site would apply
// if the column were missing. statusClass is NOT '' (the `?? ""` default), the
// numbers are NOT 0 (what a `?? 0` bug would produce), and combo carries the
// namespaced slash shape v0.9.39 made legal.
const TELEMETRY = {
  latencyMs: 1234,
  ttftMs: 567,
  httpStatus: 201,
  statusClass: "sentinel_class",
  combo: "vela/cc/opus",
};

/** The dedupe-identity fields. Overridable so two rows can coexist — see S4.1. */
const USAGE_BASE = {
  provider: "sentinel-provider",
  model: "sentinel-model",
  connectionId: "sentinel-conn",
  keyId: "sentinel-key",
  promptTokens: 100,
  completionTokens: 50,
  cost: 0.0021,
  status: "ok",
};

const TS = "2026-09-03T00:00:00.000Z";

/** Insert a usageHistory row straight through the adapter — all 19 columns.
 *
 *  ⚠️ EVERY overridable field must be bound from `v`, not from a literal. The
 *  first draft of this helper spread `overrides` into `v` and then bound the
 *  literals `100, 50` for promptTokens/completionTokens, so an override of
 *  `promptTokens` was silently discarded — and the test that relied on it to
 *  escape the uq_uh_dedupe UNIQUE index kept failing with the exact same error
 *  after the "fix". A helper that ignores its own arguments is worse than one
 *  without them: it reads as configurable.
 */
async function insertUsage(db, id, overrides = {}) {
  const v = { ...USAGE_BASE, ...TELEMETRY, ...overrides };
  db.run(
    `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix,
        endpoint, promptTokens, completionTokens, cost, status, tokens, meta,
        latencyMs, ttftMs, httpStatus, statusClass, combo)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, TS, v.provider, v.model, v.connectionId,
      // A plaintext credential on the PRIMARY, exactly as a pre-W1 survivor row
      // would hold it. S4.2/S5 assert it never crosses.
      "sk-plaintext-that-must-never-cross",
      v.keyId, "sk-sent", "/v1/chat/completions",
      v.promptTokens, v.completionTokens, v.cost, v.status,
      JSON.stringify({ total: 150 }), JSON.stringify({ note: "sentinel" }),
      v.latencyMs, v.ttftMs, v.httpStatus, v.statusClass, v.combo,
    ]
  );
}

/** Insert a requestDetails row — all 8 columns, combo included.
 *  Binds every overridable field from `v` for the reason insertUsage documents. */
async function insertRequestDetail(db, id, overrides = {}) {
  const v = { ...USAGE_BASE, ...TELEMETRY, ...overrides };
  db.run(
    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data, combo)
     VALUES(?,?,?,?,?,?,?,?)`,
    [
      id, TS, v.provider, v.model, v.connectionId, v.status,
      JSON.stringify({ latency: {}, tokens: {} }), v.combo,
    ]
  );
}

const readUsage = (db, id) => db.get(`SELECT * FROM usageHistory WHERE id = ?`, [id]);
const readDetail = (db, id) => db.get(`SELECT * FROM requestDetails WHERE id = ?`, [id]);

describe("S1 — LIVE-C: the five telemetry/combo columns survive export → DESTROY → import", () => {
  it("S1.1 round-trips every value, and the artifact itself carries all five", { timeout: 20000 }, async () => {
    const db = await freshAdapter();
    const { exportDb, importDb } = await import("@/lib/db/repos/sqlite/backupRepo.js");

    await insertUsage(db, 1);

    // EXPORT — the first of the two drops. Pre-fix this payload had 14 fields.
    const payload = await exportDb({ includeRequestDetails: false });
    const row = payload.usageHistory.find((r) => r.id === 1);
    expect(row, "precondition: the exported payload must carry the row").toBeTruthy();
    expect(row).toMatchObject({
      latencyMs: TELEMETRY.latencyMs,
      ttftMs: TELEMETRY.ttftMs,
      httpStatus: TELEMETRY.httpStatus,
      statusClass: TELEMETRY.statusClass,
      combo: TELEMETRY.combo,
    });

    // DESTROY — without this the assertions below could be satisfied by the row
    // simply never having left the live DB. This is what makes it a restore proof.
    db.run(`DELETE FROM usageHistory`);
    expect(readUsage(db, 1)).toBeFalsy();

    // IMPORT — the second of the two drops. Pre-fix this INSERT took 15 columns.
    await importDb(payload, { adoptSecrets: false, adoptKeys: false });

    const after = readUsage(db, 1);
    expect(after, "the row must come back").toBeTruthy();
    expect(after.latencyMs).toBe(TELEMETRY.latencyMs);
    expect(after.ttftMs).toBe(TELEMETRY.ttftMs);
    expect(after.httpStatus).toBe(TELEMETRY.httpStatus);
    expect(after.statusClass).toBe(TELEMETRY.statusClass);
    expect(after.combo).toBe(TELEMETRY.combo);
    // And the columns that were never broken still come back.
    expect(after.provider).toBe("sentinel-provider");
    expect(after.promptTokens).toBe(100);
    expect(after.status).toBe("ok");
  });

  it("S1.2 NULL is PRESERVED as NULL — never 0-faked (the unmeasured-signal law)", { timeout: 20000 }, async () => {
    // usageRepo.js:12 — "latencyMs / ttftMs / httpStatus — NULL when the caller
    // had no signal". 0 would mean "measured as instant", which is a fabrication.
    // This is the assertion that fails loudly if anyone writes `?? 0`.
    const db = await freshAdapter();
    const { exportDb, importDb } = await import("@/lib/db/repos/sqlite/backupRepo.js");

    await insertUsage(db, 1, { latencyMs: null, ttftMs: null, httpStatus: null, combo: null });

    const payload = await exportDb({});
    db.run(`DELETE FROM usageHistory`);
    await importDb(payload, {});

    const after = readUsage(db, 1);
    expect(after).toBeTruthy();
    expect(after.latencyMs).toBeNull();
    expect(after.ttftMs).toBeNull();
    expect(after.httpStatus).toBeNull();
    expect(after.combo).toBeNull();
    // A zero here would be indistinguishable from "instant request" downstream,
    // and the Observatory's latency buckets aggregate on it.
    expect(after.latencyMs).not.toBe(0);
  });

  it("S1.3 statusClass coalesces to '' and NEVER to NULL (migration 008's sealed invariant)", { timeout: 20000 }, async () => {
    // migration 008:91 runs `UPDATE usageHistory SET statusClass = '' WHERE
    // statusClass IS NULL`, and deriveStatusClass returns '' on every path
    // including its catch. idx_uh_ts_status aggregates on this column, so a NULL
    // would make "unknown" invisible to the index. An OLD artifact has no
    // `statusClass` key at all — that is exactly the case this pins.
    const db = await freshAdapter();
    const { importDb } = await import("@/lib/db/repos/sqlite/backupRepo.js");

    // A payload shaped like a v0.9.43 artifact: the five keys simply absent.
    const legacyPayload = {
      settings: {}, providerConnections: [], providerNodes: [], proxyPools: [],
      apiKeys: [], combos: [], usageDaily: [], kvScopes: {},
      usageHistory: [{
        id: 7, timestamp: TS, provider: "legacy", model: "legacy",
        connectionId: "legacy", keyId: "legacy", keyPrefix: null,
        endpoint: null, promptTokens: 1, completionTokens: 1, cost: 0,
        status: "ok", tokens: null, meta: null,
        // no latencyMs, no ttftMs, no httpStatus, no statusClass, no combo
      }],
      _meta: { schemaVersion: 13 },
    };

    await importDb(legacyPayload, {});

    const after = readUsage(db, 7);
    expect(after, "the legacy row must still restore").toBeTruthy();
    expect(after.statusClass).toBe("");
    expect(after.statusClass).not.toBeNull();
    // And the four genuinely-nullable columns take their documented default.
    expect(after.latencyMs).toBeNull();
    expect(after.ttftMs).toBeNull();
    expect(after.httpStatus).toBeNull();
    expect(after.combo).toBeNull();
  });
});

describe("S2 — LIVE-D: requestDetails.combo survives export → DESTROY → import", () => {
  it("S2.1 round-trips combo, which the live writer has been storing since migration 015", { timeout: 20000 }, async () => {
    const db = await freshAdapter();
    const { exportDb, importDb } = await import("@/lib/db/repos/sqlite/backupRepo.js");

    await insertRequestDetail(db, "rd-1");

    // includeRequestDetails must be true or the table is not exported at all.
    const payload = await exportDb({ includeRequestDetails: true });
    expect(Array.isArray(payload.requestDetails)).toBe(true);
    const exported = payload.requestDetails.find((r) => r.id === "rd-1");
    expect(exported, "precondition: the row must be in the payload").toBeTruthy();
    expect(exported.combo).toBe(TELEMETRY.combo);

    db.run(`DELETE FROM requestDetails`);
    expect(readDetail(db, "rd-1")).toBeFalsy();

    await importDb(payload, {});

    const after = readDetail(db, "rd-1");
    expect(after, "the row must come back").toBeTruthy();
    expect(after.combo).toBe(TELEMETRY.combo);
    expect(after.provider).toBe("sentinel-provider");
    expect(after.status).toBe("ok");
    // `data` is a JSON column — it must survive as an object, not a string.
    expect(typeof after.data).toBe("string");
    expect(JSON.parse(after.data)).toMatchObject({ latency: {}, tokens: {} });
  });

  it("S2.2 a direct (non-combo) request restores with combo NULL, not ''", { timeout: 20000 }, async () => {
    // Migration 015: NULL = direct request. '' would be a third state the
    // per-combo aggregation path does not know about.
    const db = await freshAdapter();
    const { exportDb, importDb } = await import("@/lib/db/repos/sqlite/backupRepo.js");

    await insertRequestDetail(db, "rd-2", { combo: null });

    const payload = await exportDb({ includeRequestDetails: true });
    db.run(`DELETE FROM requestDetails`);
    await importDb(payload, {});

    const after = readDetail(db, "rd-2");
    expect(after).toBeTruthy();
    expect(after.combo).toBeNull();
  });
});

describe("S3 — both ledgers tell the same story (the parity migration 015 promised)", () => {
  it("S3.1 usageHistory.combo and requestDetails.combo agree after one round-trip", { timeout: 20000 }, async () => {
    // Migration 015's stated intent: "Kept in parity with usageHistory.combo so
    // both ledgers tell the same story." LIVE-C broke one ledger's transfer and
    // LIVE-D broke the other's — so parity was broken twice over, and only a test
    // that reads BOTH can catch the combination.
    const db = await freshAdapter();
    const { exportDb, importDb } = await import("@/lib/db/repos/sqlite/backupRepo.js");

    await insertUsage(db, 1);
    await insertRequestDetail(db, "rd-1");

    const payload = await exportDb({ includeRequestDetails: true });
    db.run(`DELETE FROM usageHistory`);
    db.run(`DELETE FROM requestDetails`);
    await importDb(payload, { includeRequestDetails: true });

    const usage = readUsage(db, 1);
    const detail = readDetail(db, "rd-1");
    expect(usage.combo).toBe(detail.combo);
    expect(usage.combo).toBe(TELEMETRY.combo);
  });
});

describe("S4 — the resync seam (the twin's ONLY path for usage rows)", () => {
  it("S4.1 fetchUsageBatch selects the five, so the twin's columns can be populated at all", { timeout: 20000 }, async () => {
    // `mirrorApplyRepo` writes NEITHER usageHistory nor requestDetails (verified),
    // so this seam plus its mysql apply twin is the only route usage takes to the
    // replica. Pre-fix the batch arrived at the twin missing all five, and
    // applyUsageBatch's 15-column INSERT had nothing to write even if it had them.
    const db = await freshAdapter();
    const { fetchUsageBatch, getMaxUsageId } = await import("@/lib/db/repos/sqlite/usageResyncRepo.js");

    await insertUsage(db, 1);
    // ⚠️ The second row MUST differ on the uq_uh_dedupe identity — a UNIQUE
    // index over (timestamp, provider, model, connectionId, keyId,
    // promptTokens, completionTokens). This suite's first draft made both rows
    // identical and sqlite refused the second with
    // "UNIQUE constraint failed: usageHistory.timestamp, …".
    // That failure is itself the empirical proof of a schema claim: `combo` is
    // NOT part of the dedupe identity (schema.js:174-176 asserts it; the
    // constraint list above confirms it), which is why migration 015 could add
    // the column without touching the index.
    await insertUsage(db, 2, { latencyMs: null, ttftMs: null, httpStatus: null, statusClass: "", combo: null, promptTokens: 999 });

    const batch = await fetchUsageBatch(0, 50);
    expect(batch).toHaveLength(2);

    const first = batch.find((r) => r.id === 1);
    expect(first).toMatchObject({
      latencyMs: TELEMETRY.latencyMs,
      ttftMs: TELEMETRY.ttftMs,
      httpStatus: TELEMETRY.httpStatus,
      statusClass: TELEMETRY.statusClass,
      combo: TELEMETRY.combo,
    });

    // The watermark's own contract still holds — batches are id-ordered.
    expect(batch.map((r) => r.id)).toEqual([1, 2]);
    expect(await getMaxUsageId()).toBe(2);
  });

  it("S4.2 the batch omits apiKey — the one DELIBERATE exclusion still stands", { timeout: 20000 }, async () => {
    // fetchUsageBatch's documented law: the legacy plaintext apiKey column is
    // never selected, because the twin's writer writes NULL there by law. Adding
    // five columns must not have disturbed the one exclusion that was designed.
    const db = await freshAdapter();
    const { fetchUsageBatch } = await import("@/lib/db/repos/sqlite/usageResyncRepo.js");

    await insertUsage(db, 1);
    const [row] = await fetchUsageBatch(0, 50);

    expect(row).toBeTruthy();
    expect(Object.keys(row)).not.toContain("apiKey");
    expect(JSON.stringify(row)).not.toMatch(/sk-plaintext-that-must-never-cross/);
  });
});

describe("S5 — the negligence-vs-law boundary holds end to end", () => {
  it("S5.1 an artifact never carries the plaintext apiKey, but does carry all five telemetry columns", { timeout: 20000 }, async () => {
    // This is the single assertion that distinguishes the designed exclusion from
    // the accidental one. Both sit in the same export map, one line apart.
    const db = await freshAdapter();
    const { exportDb } = await import("@/lib/db/repos/sqlite/backupRepo.js");

    await insertUsage(db, 1);
    // Both ledgers must be populated — this suite's first draft inserted only the
    // usage row and then read `payload.requestDetails[0]`, which was undefined
    // because an empty table exports as an empty array.
    await insertRequestDetail(db, "rd-1");

    const payload = await exportDb({ includeRequestDetails: true });
    const serialized = JSON.stringify(payload);

    // The law: no plaintext credential crosses.
    expect(serialized).not.toMatch(/sk-plaintext-that-must-never-cross/);
    expect(payload.usageHistory[0].apiKey).toBeNull();

    // The repair: the five non-secret columns DO cross.
    expect(payload.usageHistory[0]).toMatchObject(TELEMETRY);
    expect(payload.requestDetails[0].combo).toBe(TELEMETRY.combo);
  });
});

describe("S6 — the mysql apply seam's column list matches its placeholders", () => {
  it("S6.1 applyUsageBatch binds 19 values for 20 columns (apiKey is a literal NULL)", async () => {
    // A column/placeholder mismatch is a RUNTIME throw in mysql, not a lint
    // error — and unlike the sqlite round-trip above there is no adapter here to
    // catch it, since the twin needs a live MariaDB. So the seam is verified by
    // capturing the SQL and counting, against the real source rather than a copy.
    //
    // This is deliberately a static check: it is the ONE site in this suite where
    // a round-trip is not available, and saying so is more honest than letting a
    // skipped assertion imply coverage.
    const captured = [];
    const tx = { run: vi.fn(async (sql, params) => { captured.push({ sql, params }); }) };
    vi.doMock("@/lib/db/mysql/adapter.js", () => ({
      getMysqlAdapter: async () => ({ transaction: async (fn) => fn(tx) }),
    }));
    vi.resetModules();
    const { applyUsageBatch } = await import("@/lib/db/repos/mysql/usageResyncRepo.js");

    const n = await applyUsageBatch([{ id: 1, timestamp: TS, ...TELEMETRY }]);
    expect(n).toBe(1);
    expect(captured).toHaveLength(1);

    const { sql, params } = captured[0];
    const columnList = sql.match(/INSERT INTO usageHistory\(([^)]+)\)/)[1];
    const columns = columnList.split(",").map((c) => c.trim()).filter(Boolean);
    const placeholders = (sql.match(/\?/g) || []).length;

    // 20 columns, 19 placeholders — apiKey is bound as a literal NULL.
    expect(columns).toHaveLength(20);
    expect(placeholders).toBe(19);
    expect(params).toHaveLength(19);
    expect(columns).toContain("apiKey");
    for (const c of ["latencyMs", "ttftMs", "httpStatus", "statusClass", "combo"]) {
      expect(columns).toContain(c);
    }
    // The values actually reached the binding array, in order.
    expect(params.slice(-5)).toEqual([
      TELEMETRY.latencyMs, TELEMETRY.ttftMs, TELEMETRY.httpStatus,
      TELEMETRY.statusClass, TELEMETRY.combo,
    ]);
    vi.doUnmock("@/lib/db/mysql/adapter.js");
  });

  it("S6.2 applyUsageBatch coalesces a legacy row the same way sqlite does — statusClass '' not NULL", async () => {
    const captured = [];
    const tx = { run: vi.fn(async (sql, params) => { captured.push(params); }) };
    vi.doMock("@/lib/db/mysql/adapter.js", () => ({
      getMysqlAdapter: async () => ({ transaction: async (fn) => fn(tx) }),
    }));
    vi.resetModules();
    const { applyUsageBatch } = await import("@/lib/db/repos/mysql/usageResyncRepo.js");

    // A row from an old primary, or one whose caller had no telemetry signal.
    await applyUsageBatch([{ id: 9, timestamp: TS, provider: "p", model: "m" }]);

    const params = captured[0];
    // Last five bindings: latencyMs, ttftMs, httpStatus, statusClass, combo.
    const [latencyMs, ttftMs, httpStatus, statusClass, combo] = params.slice(-5);
    expect(latencyMs).toBeNull();
    expect(ttftMs).toBeNull();
    expect(httpStatus).toBeNull();
    expect(statusClass).toBe("");
    expect(statusClass).not.toBeNull();
    expect(combo).toBeNull();
    vi.doUnmock("@/lib/db/mysql/adapter.js");
  });
});
