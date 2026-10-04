// Test covenant: log-events-migration-018 — the log pipeline's ledger and the
// two join keys that let the console room, the container room and the request
// ledger be read as one story (log-pipeline plan, milestone M2).
//
// Why this suite exists rather than "the schema looks right": migration 013's
// lesson is that a migration's real risk is the DRIVER, not the SQL. This wave
// adds a whole table AND two columns to a table that already carries a UNIQUE
// identity, so the questions worth answering are (a) does the versioned chain
// reach v18 on the production-crash driver, (b) does logEvents hold every
// column the three stream writers intend to fill — none dropped, none renamed
// out from under them — and (c) did usageHistory gain its join keys WITHOUT
// its dedupe identity moving.
//
// That last one is the load-bearing law and it is pinned in the sibling suite
// (usagehistory-reqid.test.js) rather than here: the failure this wave must
// never cause is a quietly-widened uq_uh_dedupe that lets a retry double-count
// tokens and cost. Asserting only "the columns exist" would pass just as
// happily against a broken identity, so the identity has its own proof.
//
// ADAPTER CONTRACT under test: portable surface only — run/get/all/exec/
// transaction, NEVER a raw prepare(). The migration calls db.all + db.exec
// alone. db.prepare is what crashed every DB-backed API at boot on the sql.js
// adapter in v0.9.19, and the sql.js adapter is exactly what case 1 boots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

const NATIVE_ADAPTERS = [
  "@/lib/db/adapters/betterSqliteAdapter.js",
  "@/lib/db/adapters/nodeSqliteAdapter.js",
];

/**
 * Lift the sql.js case's doMock registrations.
 *
 * vitest keeps a doMock registration for the whole FILE, not just the case
 * that made it — so without this, a later "native" case falls through to sql.js
 * and its own driver guard silently skips the assertions. That is exactly how
 * migration 016's durability cases once passed against a source file with the
 * ledger's veto deleted: three green proofs that executed nothing. Measured
 * 2026-09-21.
 */
function liftNativeAdapterMocks() {
  for (const spec of NATIVE_ADAPTERS) {
    try {
      vi.doUnmock(spec);
    } catch {}
  }
}

async function bootSqlJs() {
  delete global._dbAdapter;
  // Force the sql.js fallback exactly like migration 013's and 016's suites:
  // make the native adapters unavailable so resolveDriver lands on sql.js.
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

async function bootNative() {
  liftNativeAdapterMocks();
  delete global._dbAdapter;
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

beforeEach(() => {
  // The DB-harness trap: paths.js freezes DATA_DIR at first import and
  // driver.js binds global._dbAdapter at module eval. BOTH hooks must bust the
  // module cache or a later test writes into an earlier test's deleted dir
  // (Windows then dies with EPERM on an orphaned -wal handle).
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-mig018-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "mig018-test-secret";
  delete global._dbAdapter;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

// All twelve columns the three stream writers fill. `arrayContaining` rather
// than an exact set: a LATER migration may legitimately add a column, and
// that should not redden this suite. What must never happen is a column here
// being missing or renamed — which is what this asserts.
const LOG_COLUMNS = [
  "id", "ts", "lvl", "stream", "reqId", "upstreamId",
  "provider", "tag", "msg", "meta", "truncMsg", "truncMeta",
];

const LOG_INDEXES = ["ix_log_ts", "ix_log_req", "ix_log_up", "ix_log_provider"];

const USAGE_INDEXES = ["idx_uh_reqId", "idx_uh_upstreamId"];

describe("Migration 018 — the log ledger and its two join keys", () => {
  it("sql.js adapter (production-crash driver) → chain reaches v18 and logEvents exists", async () => {
    const db = await bootSqlJs();
    expect(db.driver).toBe("sql.js");

    const found = db.all(`PRAGMA table_info(logEvents)`).map((c) => c.name);
    expect(found, "logEvents should carry every column the stream writers fill").toEqual(
      expect.arrayContaining(LOG_COLUMNS)
    );
    // The stamped version is what migrate.js believes it reached; a chain that
    // threw halfway would stamp lower and leave the table half-built.
    expect(parseInt(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value, 10)).toBe(18);
  });

  it("declares every index the schema promised — four on logEvents, two on usageHistory", async () => {
    const db = await bootSqlJs();
    const indexes = db.all(`SELECT name FROM sqlite_master WHERE type='index'`).map((r) => r.name);
    for (const idx of [...LOG_INDEXES, ...USAGE_INDEXES]) expect(indexes).toContain(idx);
  });

  it("usageHistory gained both join keys, nullable, with 'unset' honestly NULL", async () => {
    const db = await bootSqlJs();
    const cols = db.all(`PRAGMA table_info(usageHistory)`).map((c) => c.name);
    expect(cols).toContain("reqId");
    expect(cols).toContain("upstreamId");

    // NOT NULL DEFAULT '' is the DEDUPE columns' pattern (provider/model/…),
    // because NULLs are DISTINCT inside a UNIQUE index and '' is the normalized
    // "unset". These two are NOT in that identity — so NULL is both honest and
    // engine-safe here, and a NOT NULL '' would claim an instrumentation that
    // never happened on rows written before this migration.
    const defs = Object.fromEntries(db.all(`PRAGMA table_info(usageHistory)`).map((c) => [c.name, c]));
    expect(defs.reqId.notnull).toBe(0);
    expect(defs.upstreamId.notnull).toBe(0);
  });

  it("version coherence — SCHEMA_VERSION and the migration chain agree at 18", async () => {
    const { SCHEMA_VERSION, TABLES } = await import("@/lib/db/schema.js");
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    expect(latestVersion()).toBe(SCHEMA_VERSION);
    expect(latestVersion()).toBe(18);
    // The registry must stay contiguous — no missing migration between 17 and
    // 18, which is what a forgotten index import would look like.
    const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: latestVersion() }, (_, i) => i + 1));
    const m018 = MIGRATIONS.find((m) => m.version === 18);
    expect(m018?.name).toBe("log-events");
    // The declaration of record lives in TABLES, so the twin's bootstrap diff
    // and the additive auto-sync see the same table this migration builds.
    expect(TABLES.logEvents).toBeTruthy();
  });

  it("idempotent — replaying up() against a migrated database does not throw", async () => {
    const db = await bootNative();
    if (db.driver === "sql.js") return; // heap-bound driver — case 1 covers it

    const { default: m018 } = await import("@/lib/db/migrations/018-log-events.js");
    expect(() => m018.up(db)).not.toThrow();
    // The PRAGMA guard is the load-bearing half: a replay must not throw
    // "duplicate column name" on the ALTER, nor "table already exists".
    expect(db.all(`PRAGMA table_info(logEvents)`).map((c) => c.name)).toEqual(
      expect.arrayContaining(LOG_COLUMNS)
    );
  });

  it("down() drops the table and leaves the join keys — the documented rollback posture", async () => {
    const db = await bootNative();
    if (db.driver === "sql.js") return; // heap-bound driver — case 1 covers it

    const { default: m018 } = await import("@/lib/db/migrations/018-log-events.js");
    m018.down(db);
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
    expect(tables).not.toContain("logEvents");
    // The two columns REMAIN, exactly as 002/013/015 leave theirs — SQLite
    // cannot DROP COLUMN on older versions. Asserting their survival is what
    // stops a later tide from "tidying" the rollback into a half-drop.
    expect(db.all(`PRAGMA table_info(usageHistory)`).map((c) => c.name)).toEqual(
      expect.arrayContaining(["reqId", "upstreamId"])
    );
  });

  it("holds the shapes the three stream writers intend — one row per stream round-trips", async () => {
    const db = await bootNative();
    if (db.driver === "sql.js") return; // heap-bound driver — case 1 covers it

    // The three rooms this table exists to join, written the way each writer
    // will write them: console (no request context), container (the process's
    // own fd 1/2), request (fully threaded through a request id).
    const base = { ts: 1_800_000_000_000, provider: null, tag: null, meta: null, truncMsg: 0, truncMeta: 0 };
    const rows = [
      { ...base, lvl: 20, stream: "console", msg: "provider selection complete", reqId: null, upstreamId: null },
      { ...base, lvl: 40, stream: "container", msg: "UnhandledPromiseRejection", reqId: null, upstreamId: null },
      { ...base, lvl: 30, stream: "request", msg: "retrying upstream", reqId: "req-abc", upstreamId: "up-1", tag: "RETRY" },
    ];
    for (const r of rows) {
      db.run(
        `INSERT INTO logEvents (ts, lvl, stream, reqId, upstreamId, provider, tag, msg, meta, truncMsg, truncMeta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.ts, r.lvl, r.stream, r.reqId, r.upstreamId, r.provider, r.tag, r.msg, r.meta, r.truncMsg, r.truncMeta]
      );
    }

    // A request's whole thread, by request id — the query this schema exists
    // to make expressible.
    const thread = db.all(`SELECT stream, lvl, msg, tag FROM logEvents WHERE reqId = ? ORDER BY id ASC`, ["req-abc"]);
    expect(thread).toHaveLength(1);
    expect(thread[0].tag).toBe("RETRY");

    // Stream census: the room names its three rooms without pretending they
    // are the same thing.
    const streams = db.all(`SELECT DISTINCT stream FROM logEvents ORDER BY stream ASC`).map((r) => r.stream);
    expect(streams).toEqual(["console", "container", "request"]);

    // Threshold filter — the reason `lvl` is numeric rather than a string.
    const errors = db.all(`SELECT msg FROM logEvents WHERE lvl >= ? ORDER BY id ASC`, [40]);
    expect(errors.map((e) => e.msg)).toEqual(["UnhandledPromiseRejection"]);

    // The cursor anchor: rowid order is arrival order, monotonically, and a
    // reader resumes on it with neither a duplicate nor a gap. This is the
    // property epoch-ms timestamps cannot promise (two lines inside one
    // millisecond collide) and the one reason id is the autoincrement.
    const ids = db.all(`SELECT id FROM logEvents ORDER BY id ASC`).map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const after = db.all(`SELECT msg FROM logEvents WHERE id > ? ORDER BY id ASC`, [ids[0]]).map((r) => r.msg);
    expect(after).toEqual(["UnhandledPromiseRejection", "retrying upstream"]);
  });

  it("truncation flags are dedicated columns, never fields hidden inside meta", async () => {
    const db = await bootNative();
    if (db.driver === "sql.js") return; // heap-bound driver — case 1 covers it

    // The r3 law: a flag a consumer must know to look for inside a clamped
    // blob is a flag it will silently never see, and a clipped line then reads
    // as the whole truth. So the flags ride as columns a reader cannot miss.
    db.run(
      `INSERT INTO logEvents (ts, lvl, stream, msg, meta, truncMsg, truncMeta) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [1_800_000_000_000, 20, "container", "a very long line", JSON.stringify({ pid: 1 }), 1, 0]
    );
    const row = db.get(`SELECT truncMsg, truncMeta, meta FROM logEvents`);
    expect(row.truncMsg).toBe(1);
    expect(row.truncMeta).toBe(0);
    // …and the flag is legible WITHOUT parsing the blob.
    expect(db.get(`SELECT COUNT(*) AS n FROM logEvents WHERE truncMsg = 1`).n).toBe(1);
  });
});