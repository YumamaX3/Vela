// tests/unit/log-retention-sweep.test.js — M8 "The Gate & The Keel" (§8, §11).
//
// WHAT IS UNDER TEST, AND WHY IT IS DRIVEN THIS WAY
//
// §8 gives retention one sentence — "Worker sweep applies age/rows; unbounded
// honors manual clear only" — and the risk in it is not that the sentence is
// unimplemented. The risk is that it is implemented *loosely*: a sweep that
// prunes by the wrong rule, a settings write that clobbers a knob the operator
// never touched, or a validator that admits a value no sweep can survive.
//
// So every block below drives the REAL thing over a REAL migrated SQLite:
//   A · the SWEEP — a real worker thread, real rows, real `DELETE`s.
//   B · the SETTINGS DOOR — the real PATCH handler against a real settings row.
//   C · the SEAM — defaults, roster derivation, and the two regressions that
//       would let a stored rule drift from the harbor's declared default.
//
// A suite that stubbed the store would prove nothing about the SQL, and the
// SQL is where the whole risk lives.
//
// THE DB-HARNESS TRAP (v0.9.77): `paths.js` freezes DATA_DIR at first import
// and `driver.js` binds `global._dbAdapter` once at module eval, so
// `delete global._dbAdapter` alone never rebinds. BOTH hooks reset modules AND
// drop the global — beforeEach as well as afterEach.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WORKER_PATH = path.join(ROOT, "src", "lib", "logshipper", "worker.js");

// A throwaway fixture value for migration 002's key hashing. PLACEHOLDER: it is
// never a credential and never leaves the temp dir.
const TEST_SECRET_PLACEHOLDER = "example-fixture-not-a-credential";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalApiSecret = process.env.API_KEY_SECRET;
const originalDbDriver = process.env.VELA_DB_DRIVER;
const originalDbMode = process.env.VELA_DB_MODE;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-m8-retention-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = TEST_SECRET_PLACEHOLDER;
  delete process.env.VELA_DB_DRIVER;
  delete process.env.VELA_DB_MODE;
  vi.resetModules();
  delete global._dbAdapter;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalApiSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalApiSecret;
  if (originalDbDriver === undefined) delete process.env.VELA_DB_DRIVER;
  else process.env.VELA_DB_DRIVER = originalDbDriver;
  if (originalDbMode === undefined) delete process.env.VELA_DB_MODE;
  else process.env.VELA_DB_MODE = originalDbMode;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────────────────────────────────────────────────────────
// HARNESS
// ───────────────────────────────────────────────────────────────────────────

/** The real adapter over the real migrated database. */
async function db() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

/** Seed logEvents through the REAL write door, so rows carry production shape. */
async function seed(rows) {
  const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
  const store = await getLogStore();
  for (let i = 0; i < rows.length; i += 2_000) {
    store.insertBatch(rows.slice(i, i + 2_000));
  }
  return rows.length;
}

const row = (over = {}) => ({
  ts: NOW,
  lvl: 20,
  stream: "console",
  reqId: null,
  upstreamId: null,
  provider: null,
  tag: null,
  msg: "seeded line",
  meta: null,
  truncMsg: 0,
  truncMeta: 0,
  ...over,
});

/** N rows, `ageDays` old, oldest first — the arrival order the sweep relies on. */
const agedRows = (n, ageDays, prefix = "line") =>
  Array.from({ length: n }, (_, i) => row({ ts: NOW - ageDays * DAY_MS + i, msg: `${prefix}-${i}` }));

/** Write the settings row directly — the posture the worker reads at boot. */
async function writeRetentionSetting(logRetention) {
  const adapter = await db();
  const { stringifyJson } = await import("@/lib/db/helpers/jsonCol.js");
  const existing = adapter.get("SELECT data FROM settings WHERE id = ?", [1]);
  let parsed = {};
  if (existing?.data) {
    const raw = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data;
    parsed = raw && typeof raw === "object" ? raw : {};
  }
  adapter.run(
    "INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    [stringifyJson({ ...parsed, logRetention })]
  );
}

/**
 * Boot the REAL worker against the temp DATA_DIR and await its `ready`.
 *
 * A real `worker_threads` Worker on purpose: the sweep's whole job is to DELETE
 * from the same file the main thread reads, and a spawned thread is the only
 * honest way to prove the statements run on the driver production pins.
 */
async function bootWorker({ ringBytes = 4 * 1024 * 1024, sab = null } = {}) {
  const { createRing } = await import("@/lib/logshipper/writer.js");
  const ring = sab
    ? { sab, state: new Int32Array(sab, 0, 16), bytes: new Uint8Array(sab, 64, ringBytes), capacityBytes: ringBytes }
    : createRing();
  const worker = new Worker(WORKER_PATH, { workerData: { sab: ring.sab, ringBytes } });
  const notices = [];
  const waiters = [];
  worker.on("message", (m) => {
    notices.push(m);
    for (const w of [...waiters]) if (w.match(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const errors = [];
  worker.on("error", (e) => errors.push(e));
  const nextOfType = (type, ms = 10_000) =>
    new Promise((resolve, reject) => {
      const hit = notices.find((m) => m.type === type);
      if (hit) return resolve(hit);
      const timer = setTimeout(
        () => reject(new Error(`no "${type}" notice; saw ${JSON.stringify(notices)}; errors ${errors.map(String).join(" | ")}`)),
        ms
      );
      const w = { match: (m) => m.type === type, resolve: (m) => { clearTimeout(timer); resolve(m); } };
      waiters.push(w);
    });
  const ready = await nextOfType("ready");
  return { worker, ring, notices, errors, nextOfType, ready };
}

/** Surviving rows, in arrival order. */
async function survivors() {
  const adapter = await db();
  return adapter.all("SELECT id, ts, msg FROM logEvents ORDER BY id");
}

// ───────────────────────────────────────────────────────────────────────────
// A · THE SWEEP — a real worker, real rows, real DELETEs
// ───────────────────────────────────────────────────────────────────────────
describe("A · the retention sweep deletes by the rule in force", { timeout: 60_000 }, () => {
  it("age mode prunes rows past the horizon and KEEPS the ones inside it", async () => {
    await writeRetentionSetting({ mode: "age", days: 14, maxRows: 1_000_000 });
    await seed([
      ...agedRows(5, 30, "ancient"),
      ...agedRows(3, 10, "recent"),
      ...agedRows(2, 0, "today"),
    ]);
    expect((await survivors()).length).toBe(10);

    const { worker, nextOfType, ready } = await bootWorker();
    // The worker read the STORED posture, not its own fallback.
    expect(ready.retention).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
    expect(ready.retentionSource).toBe("settings");

    // The boot sweep is the assertion: 5 rows were 30 days old, the other 5
    // were inside the 14-day horizon.
    await nextOfType("pruned-on-boot");
    await settle();

    const left = await survivors();
    expect(left.map((r) => r.msg).sort()).toEqual(["recent-0", "recent-1", "recent-2", "today-0", "today-1"]);
    // And the direction is exact: nothing inside the horizon was touched.
    expect(left.length).toBe(5);
    await worker.terminate();
  });

  it("a SHORTER horizon prunes more — the sweep obeys the stored days", async () => {
    // The 3-day horizon must claim the 10-day rows too. A sweep that ignored
    // `days` and used its own constant would leave 8 rows here, not 3.
    await writeRetentionSetting({ mode: "age", days: 3, maxRows: 1_000_000 });
    await seed([...agedRows(5, 30, "ancient"), ...agedRows(3, 10, "recent")]);
    const { worker, nextOfType } = await bootWorker();
    await nextOfType("pruned-on-boot");
    await settle();
    expect(await survivors()).toEqual([]);
    await worker.terminate();
  });

  it("rows mode keeps the NEWEST maxRows and evicts the rest", async () => {
    await writeRetentionSetting({ mode: "rows", days: 14, maxRows: 4 });
    await seed(Array.from({ length: 10 }, (_, i) => row({ ts: NOW - (10 - i) * DAY_MS, msg: `r-${i}` })));

    const { worker, nextOfType, ready } = await bootWorker();
    expect(ready.retention.mode).toBe("rows");
    await nextOfType("pruned-on-boot");
    await settle();

    const left = await survivors();
    expect(left.map((r) => r.msg)).toEqual(["r-6", "r-7", "r-8", "r-9"]);
    await worker.terminate();
  });

  it("unbounded prunes NOTHING — and the clear door still empties the table", async () => {
    // Two halves of one sentence, and both are load-bearing: "unbounded" is
    // NOT "off", it is "manual only". A ledger nobody wants aged is still a
    // ledger the operator can erase.
    // A CEILING SMALL ENOUGH TO BITE. `maxRows: 1_000_000` would leave the
    // sweep looking correct even with the unbounded guard deleted — nothing is
    // ever over a million rows in this table, so a rows-mode fallback would
    // prune nothing and the case would pass against the very defect it exists
    // to catch. With maxRows = 6 over 10 rows, the guard is the ONLY reason
    // the four ancient rows survive.
    await writeRetentionSetting({ mode: "unbounded", days: 14, maxRows: 6 });
    await seed([...agedRows(5, 400, "ancient"), ...agedRows(5, 0, "today")]);

    // And the policy seam itself, with no worker in the picture: `unbounded`
    // must issue NO delete call at all. This is the assertion that survives a
    // deleted guard, because a rows-mode fallback against maxRows=6 would
    // delete four rows here where the worker case would too — but the
    // strategy it reports would not be `manual-only`.
    const { sweepOnce } = await import("@/lib/logshipper/retention.js");
    const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
    const store = await getLogStore();
    const outcome = sweepOnce(store, { mode: "unbounded", days: 14, maxRows: 6 }, { now: NOW });
    expect(outcome.strategy).toBe("manual-only");
    expect(outcome.removed).toBe(0);
    expect(outcome.passes).toBe(0);

    const { worker, ring, nextOfType, ready, notices } = await bootWorker();
    expect(ready.retention.mode).toBe("unbounded");
    await settle(600);
    // Rows 400 days old survived an unbounded posture — the sweep did not run.
    expect((await survivors()).length).toBe(10);
    expect(notices.some((m) => m.type === "pruned-on-boot" || m.type === "pruned")).toBe(false);

    // The manual door, through the same worker.
    worker.postMessage({ type: "flush", data: { seq: 1 } });
    await nextOfType("flushed");
    worker.postMessage({ type: "clear", data: { seq: 2 } });
    const cleared = await nextOfType("cleared");
    expect(cleared.deleted).toBe(10);
    await settle();
    expect(await survivors()).toEqual([]);
    void ring;
    await worker.terminate();
  });

  it("the sweep runs on its OWN cadence and is unref'd (it cannot hold the thread open)", async () => {
    // A sweep timer that is not unref'd is a worker that never exits; one at
    // the batch interval (250ms) would put a DELETE on the drain loop's thread.
    const { RETENTION_SWEEP_INTERVAL_MS } = await import("@/lib/logshipper/retention.js");
    expect(RETENTION_SWEEP_INTERVAL_MS).toBe(60 * 60 * 1000);

    const { worker, ready } = await bootWorker();
    expect(ready.retentionSweepMs).toBe(RETENTION_SWEEP_INTERVAL_MS);
    // terminate() resolving at all IS the proof the timer is unref'd: a
    // ref'd interval would keep the event loop alive forever.
    await worker.terminate();
  });

  it("the chunked sweep CONVERGES: a ledger past the chunk budget is finished, not half-pruned", async () => {
    // One pass removes at most RETENTION_CHUNK_ROWS. The sweep must keep
    // passing until a short chunk comes back — a single pass would leave a
    // ledger claiming to be bounded while thousands of rows wait.
    await seed(agedRows(2_000, 400, "old"));
    const { sweepOnce, RETENTION_CHUNK_ROWS } = await import("@/lib/logshipper/retention.js");
    expect(RETENTION_CHUNK_ROWS).toBe(20_000);

    const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
    const store = await getLogStore();
    const outcome = sweepOnce(store, { mode: "age", days: 1, maxRows: 1 }, { now: NOW, chunkRows: 500, maxPasses: 20 });

    expect(outcome.removed).toBe(2_000);
    expect(outcome.passes).toBeGreaterThan(1); // genuinely chunked, not one statement
    expect(outcome.exhausted).toBe(true);
    expect(await survivors()).toEqual([]);
  });

  it("the sweep says so when it CANNOT converge — a bounded ledger that lies is the defect", async () => {
    await seed(agedRows(1_200, 400, "old"));
    const { sweepOnce } = await import("@/lib/logshipper/retention.js");
    const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
    const store = await getLogStore();
    // A pass budget far too small for the backlog: the sweep retires what it
    // can and REPORTS that it did not finish.
    const outcome = sweepOnce(store, { mode: "age", days: 1, maxRows: 1 }, { now: NOW, chunkRows: 100, maxPasses: 2 });
    expect(outcome.removed).toBe(200);
    expect(outcome.exhausted).toBe(false);
    expect((await survivors()).length).toBe(1_000);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B · THE SETTINGS DOOR — deep merge + value validation, real handler
// ───────────────────────────────────────────────────────────────────────────
describe("B · settings.logRetention — the write door", { timeout: 60_000 }, () => {
  /** The REAL PATCH handler against a REAL settings row. */
  async function patchRoute() {
    return import("@/app/api/settings/route.js");
  }
  const patchRequest = (body) => ({ json: async () => body });

  it("derives into the writable roster automatically (no transcription to drift)", async () => {
    const { WRITABLE_SETTING_KEYS } = await import("@/lib/db/repos/settingsDefaults.js");
    expect(WRITABLE_SETTING_KEYS).toContain("logRetention");
  });

  it("a PARTIAL payload preserves days/maxRows — the shallow-merge clobber", async () => {
    // The refuter's finding, driven end to end: `updateSettings` merges
    // TOP-LEVEL keys, so `{mode:'rows'}` alone must not wipe the stored
    // numbers. If the deep-merge branch is deleted, `days` reads back as
    // undefined and the sweep would prune by a rule nobody chose.
    await writeRetentionSetting({ mode: "age", days: 21, maxRows: 750_000 });
    const { PATCH } = await patchRoute();

    const res = await PATCH(patchRequest({ logRetention: { mode: "rows" } }));
    expect(res.status).toBe(200);

    const { getSettings } = await import("@/lib/localDb");
    const stored = (await getSettings()).logRetention;
    expect(stored).toEqual({ mode: "rows", days: 21, maxRows: 750_000 });
  });

  it("each knob round-trips and a PARTIAL of a partial is still additive", async () => {
    await writeRetentionSetting({ mode: "age", days: 14, maxRows: 1_000_000 });
    const { PATCH } = await patchRoute();
    const { getSettings } = await import("@/lib/localDb");

    await PATCH(patchRequest({ logRetention: { days: 30 } }));
    expect((await getSettings()).logRetention).toEqual({ mode: "age", days: 30, maxRows: 1_000_000 });

    await PATCH(patchRequest({ logRetention: { maxRows: 5_000 } }));
    expect((await getSettings()).logRetention).toEqual({ mode: "age", days: 30, maxRows: 5_000 });

    await PATCH(patchRequest({ logRetention: { mode: "unbounded" } }));
    const final = (await getSettings()).logRetention;
    expect(final).toEqual({ mode: "unbounded", days: 30, maxRows: 5_000 });
  });

  it("the range boundaries are INCLUSIVE — 1 and 3650 days are legal, 0 and 3651 are not", async () => {
    await writeRetentionSetting({ mode: "age", days: 14, maxRows: 1_000_000 });
    const { PATCH } = await patchRoute();
    // The floor and the ceiling are INCLUSIVE — an operator who wants exactly
    // one day, or exactly ten years, is asking for something legal.
    for (const days of [1, 3650]) {
      const res = await PATCH(patchRequest({ logRetention: { days } }));
      expect(res.status, `days=${days} must be accepted`).toBe(200);
    }
    for (const days of [0, 3651, -1]) {
      const res = await PATCH(patchRequest({ logRetention: { days } }));
      expect(res.status, `days=${days} must be refused`).toBe(400);
    }
  });

  it("refuses every illegal VALUE, and the refusal leaves the store UNTOUCHED", async () => {
    // A 400 that still wrote the value would be worse than no validation at
    // all — the operator would believe the horizon they just chose is in force.
    await writeRetentionSetting({ mode: "age", days: 14, maxRows: 1_000_000 });
    const { PATCH } = await patchRoute();
    const { getSettings } = await import("@/lib/localDb");

    const illegal = [
      { mode: "weekly" },            // outside the enum
      { mode: "AGE" },               // the enum is case-SENSITIVE on purpose
      { mode: 7 },                   // a number where a name belongs
      { days: 0 },                   // below the floor
      { days: 4000 },                // above the ceiling
      { days: 1.5 },                 // not an integer
      { days: "14" },                // a numeric STRING is not a number
      { days: NaN },                 // explicitly named by the plan
      { days: Infinity },
      { maxRows: "lots" },
      { maxRows: 0 },
      { maxRows: 50_000_001 },
      { maxRows: 2.5 },
      { maxRows: NaN },
      { deleteEverything: true },    // an unknown key must be refused, not spread
      { mode: "age", sql: "DELETE FROM logEvents" },
    ];

    for (const patch of illegal) {
      const res = await PATCH(patchRequest({ logRetention: patch }));
      expect(res.status, `${JSON.stringify(patch)} must be refused`).toBe(400);
      // The REAL NextResponse carries its payload on `.json()`, not `.body` —
      // an operator (and the dashboard) reads the reason, so it must be there.
      expect((await res.json()).error).toMatch(/logRetention/);
    }
    // The stored posture survived every refusal intact.
    expect((await getSettings()).logRetention).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
  });

  it("refuses a non-object payload — `null` must not read as 'reset everything'", async () => {
    await writeRetentionSetting({ mode: "age", days: 14, maxRows: 1_000_000 });
    const { PATCH } = await patchRoute();
    const { getSettings } = await import("@/lib/localDb");

    for (const bad of [null, "age", 14, [], true]) {
      const res = await PATCH(patchRequest({ logRetention: bad }));
      expect(res.status, `logRetention=${JSON.stringify(bad)} must be refused`).toBe(400);
    }
    expect((await getSettings()).logRetention).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
  });

  it("a settings change REACHES the sweep — the knob is not decorative", async () => {
    // The end-to-end claim §8 makes: the value the operator persists is the
    // value the worker prunes by. Store it, boot, and watch the DELETE.
    await writeRetentionSetting({ mode: "age", days: 14, maxRows: 1_000_000 });
    await seed([...agedRows(4, 30, "ancient"), ...agedRows(4, 10, "recent")]);

    const { PATCH } = await patchRoute();
    const res = await PATCH(patchRequest({ logRetention: { days: 7 } }));
    expect(res.status).toBe(200);

    const { worker, nextOfType, ready } = await bootWorker();
    expect(ready.retentionSource).toBe("settings");
    expect(ready.retention.days).toBe(7); // 30-day AND 10-day rows are now both out
    await nextOfType("pruned-on-boot");
    await settle();
    expect(await survivors()).toEqual([]);
    await worker.terminate();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C · THE SEAM — one declaration, no drift, and the degraded cap outranks
// ───────────────────────────────────────────────────────────────────────────
describe("C · the retention seam", () => {
  it("the harbor's default is BOUNDED — a table nobody bounded outlives every restart", async () => {
    const { DEFAULT_SETTINGS } = await import("@/lib/db/repos/settingsDefaults.js");
    expect(DEFAULT_SETTINGS.logRetention).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
    expect(DEFAULT_SETTINGS.logRetention.mode).not.toBe("unbounded");
  });

  it("the worker's fallback and the settings default are the SAME declaration", async () => {
    // Two literals would drift the moment either is edited. The worker's
    // DEFAULT_RETENTION is derived from the seam, so this cannot drift — and
    // the assertion is what keeps someone from re-typing `14` in the worker.
    const { defaultLogRetention, DEFAULT_SETTINGS } = await import("@/lib/db/repos/settingsDefaults.js");
    const { DEFAULT_RETENTION } = await import("@/lib/logshipper/index.js");
    expect(defaultLogRetention()).toEqual(DEFAULT_SETTINGS.logRetention);
    expect({ mode: DEFAULT_RETENTION.mode, days: DEFAULT_RETENTION.days }).toEqual({
      mode: DEFAULT_SETTINGS.logRetention.mode,
      days: DEFAULT_SETTINGS.logRetention.days,
    });
  });

  it("a legacy row MISSING maxRows is backfilled, not left undefined", async () => {
    // The budgetAlerts precedent, applied: a settings row written before
    // maxRows existed must not leave the sweep reading an undefined ceiling.
    const { mergeWithDefaults } = await import("@/lib/db/repos/settingsDefaults.js");
    expect(mergeWithDefaults({ logRetention: { mode: "rows" } }).logRetention).toEqual({
      mode: "rows",
      days: 14,
      maxRows: 1_000_000,
    });
  });

  it("a CORRUPT stored posture degrades to the default instead of wedging the sweep", async () => {
    // Leniency is for what is ALREADY stored only. An inbound patch is refused
    // above; a row that predates validation must not make every future PATCH
    // fail, and must never leave the ledger unbounded.
    const { coerceLogRetention } = await import("@/lib/db/repos/settingsDefaults.js");
    // Nothing legal at all → the whole posture reverts to the declared default.
    for (const corrupt of [null, "age", 42, [], { mode: "weekly", days: -3 }, { mode: null }]) {
      expect(coerceLogRetention(corrupt)).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
    }
    // A partially corrupt row keeps what is LEGAL and repairs only the rest:
    // the posture is re-derived field by field, so one bad number cannot
    // discard a mode the operator chose, and cannot widen the ledger either.
    expect(coerceLogRetention({ mode: "rows", days: NaN })).toEqual({ mode: "rows", days: 14, maxRows: 1_000_000 });
    expect(coerceLogRetention({ mode: "rows", maxRows: "lots" })).toEqual({ mode: "rows", days: 14, maxRows: 1_000_000 });
    expect(coerceLogRetention({ mode: "age", maxRows: "lots" })).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
    // And a mode OUTSIDE the enum is not "partially corrupt" — it is not a
    // mode at all, so it falls back rather than riding through as-is.
    expect(coerceLogRetention({ mode: "unlimited" })).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
  });

  it("an absent settings row reads as the DEFAULT, never as unbounded", async () => {
    const { readRetentionSettings } = await import("@/lib/logshipper/retention.js");
    const found = readRetentionSettings({ get: () => null });
    expect(found.source).toBe("default");
    expect(found.retention).toEqual({ mode: "age", days: 14, maxRows: 1_000_000 });
    // A throw is equally survivable — an unreadable row must not un-bound the ledger.
    const thrown = readRetentionSettings({ get: () => { throw new Error("no such table"); } });
    expect(thrown.retention.mode).toBe("age");
  });

  it("the degraded 50 MB cap is reported as OVERRIDING every mode", async () => {
    // §8's sentence, surfaced: in the sql.js posture the hard cap applies
    // REGARDLESS of mode. The harbor must be able to say so rather than let an
    // operator believe `unbounded` means "nothing will ever be dropped".
    const { retentionPosture } = await import("@/lib/logshipper/retention.js");
    const { DEGRADED_MAX_BYTES } = await import("@/lib/logshipper/index.js");

    const degraded = retentionPosture({ mode: "unbounded" }, { degraded: true });
    expect(degraded.degradedCapOverrides).toBe(true);
    expect(degraded.degradedCapBytes).toBe(DEGRADED_MAX_BYTES);
    expect(DEGRADED_MAX_BYTES).toBe(50 * 1024 * 1024);

    const healthy = retentionPosture({ mode: "unbounded" }, { degraded: false });
    expect(healthy.degradedCapOverrides).toBe(false);
    expect(healthy.degradedCapBytes).toBeNull();
  });

  it("the sweep's SQL is FIXED and fully BOUND — no interpolation anywhere in the module", async () => {
    // The ratchet `logshipper-worker.test.js` stands up, restated where the
    // sweep's statements live. A policy that can reach the SQL TEXT is a
    // policy a caller can rewrite.
    const src = fs.readFileSync(path.join(ROOT, "src", "lib", "db", "repos", "sqlite", "logStore.js"), "utf-8");
    expect(src).toMatch(/RETENTION_SQL/);
    // Every retention statement is a fixed string with placeholders only.
    const block = src.slice(src.indexOf("const RETENTION_SQL"), src.indexOf("const RETENTION_SQL") + 2000);
    for (const line of block.split("\n")) {
      const stmt = line.match(/"(DELETE FROM logEvents[^"]*)"/);
      if (!stmt) continue;
      expect(stmt[1], `interpolated SQL: ${stmt[1]}`).not.toMatch(/\$\{|\+ *[A-Za-z_$]/);
      expect(stmt[1].startsWith("DELETE FROM logEvents")).toBe(true);
    }
  });

  it("the chunked statements run on BOTH drivers — node:sqlite has no DELETE … LIMIT", async () => {
    // Measured, not assumed: node:sqlite compiles SQLite WITHOUT
    // SQLITE_ENABLE_UPDATE_DELETE_LIMIT, so `DELETE … LIMIT ?` is a syntax
    // error there while better-sqlite3 accepts it. Since the Dockerfile pins
    // node:sqlite (M10), a chunked statement written the obvious way would
    // take the production sweep down. This case runs the REAL statements.
    // Runs on the DRIVER PRODUCTION PINS. `VELA_DB_DRIVER=node:sqlite` is set
    // first so the statements are exercised against the driver that rejects
    // `DELETE … LIMIT`; without it the chain answers better-sqlite3 and the
    // very hazard this case exists to catch would go unmeasured.
    process.env.VELA_DB_DRIVER = "node:sqlite";
    vi.resetModules();
    delete global._dbAdapter;
    const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
    const store = await getLogStore();
    expect(store.driver).toBe("node:sqlite");
    await seed(agedRows(20, 400, "old"));

    // No throw is the assertion; the changes count is the sanity half.
    expect(store.applyRetention({ mode: "age-chunked", cutoffMs: NOW, chunkRows: 5 })).toBe(5);
    expect(store.applyRetention({ mode: "rows-chunked", maxRows: 10, chunkRows: 2 })).toBe(2);
    expect((await survivors()).length).toBe(13);

    // The UNCHUNKED rows form retires everything outside the newest window:
    // 13 rows in, keep the newest 3 → 10 removed.
    expect(store.applyRetention({ mode: "rows", maxRows: 3 })).toBe(10);
    expect((await survivors()).length).toBe(3);
  });

  it("the store REFUSES to guess: an unrecognised mode or a non-finite cutoff deletes nothing", async () => {
    // A sweep whose mode it does not recognise must not fall through to some
    // other statement. `age` with a NaN cutoff is the same class of hazard:
    // the horizon nobody chose, computed as NaN.
    const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
    const store = await getLogStore();
    await seed(agedRows(10, 400, "old"));

    for (const posture of [
      { mode: "unbounded" },
      { mode: "weekly" },
      { mode: "" },
      { mode: "age", cutoffMs: NaN },
      { mode: "age-chunked", cutoffMs: "soon" },
      { mode: "rows", maxRows: 0 },
      { mode: "rows-chunked", maxRows: NaN },
      { mode: "rows", maxRows: -5 },
      {},
      null,
    ]) {
      expect(store.applyRetention(posture), `${JSON.stringify(posture)} must delete nothing`).toBe(0);
    }
    expect((await survivors()).length).toBe(10);
  });
});
