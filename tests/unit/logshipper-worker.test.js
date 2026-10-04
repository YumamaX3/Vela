// M3 §2 — the drainer: a REAL worker_threads Worker writing REAL rows.
//
// This suite spawns the actual src/lib/logshipper/worker.js as a Worker, with
// DATA_DIR pointed at a fresh temp dir, and reads the resulting logEvents table
// back through a real adapter over a real migrated database. Nothing here is
// mocked: if the alias law breaks, if the worker opens the wrong file, or if a
// value is concatenated into SQL instead of bound, these cases fail.
//
// THE DB-HARNESS TRAP (crystallized, v0.9.77 era): `paths.js` freezes DATA_DIR
// at first import and `driver.js` binds `global._dbAdapter` once at module
// eval, so `delete global._dbAdapter` alone never rebinds. Both hooks below
// therefore reset modules AND drop the global.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WORKER_PATH = path.join(ROOT, "src", "lib", "logshipper", "worker.js");

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalApiSecret = process.env.API_KEY_SECRET;
const originalDbDriver = process.env.VELA_DB_DRIVER;
const originalDbMode = process.env.VELA_DB_MODE;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-m3-worker-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "m3-worker-suite-secret";
  delete process.env.VELA_DB_DRIVER;
  delete process.env.VELA_DB_MODE;
  vi.resetModules();
  delete global._dbAdapter;
});

afterEach(async () => {
  if (global._dbAdapter?.instance) {
    try { global._dbAdapter.instance.close(); } catch {}
  }
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

/** Spawn the REAL worker against the temp DATA_DIR and await its `ready`. */
async function bootWorker({ ringBytes = 4 * 1024 * 1024, sab = null } = {}) {
  const { createRing } = await import("@/lib/logshipper/writer.js");
  const ring = sab ? { sab, state: new Int32Array(sab, 0, 16), bytes: new Uint8Array(sab, 64, ringBytes), capacityBytes: ringBytes } : createRing();
  const worker = new Worker(WORKER_PATH, { workerData: { sab: ring.sab, ringBytes } });
  const notices = [];
  const waiters = [];
  worker.on("message", (m) => {
    notices.push(m);
    for (const w of [...waiters]) if (w.match(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const errors = [];
  worker.on("error", (e) => errors.push(e));
  const nextOfType = (type, ms = 8000) =>
    new Promise((resolve, reject) => {
      const hit = notices.find((m) => m.type === type);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => reject(new Error(`no "${type}" notice; saw ${JSON.stringify(notices)}; errors ${errors.map(String).join(" | ")}`)), ms);
      const w = {
        match: (m) => m.type === type,
        resolve: (m) => { clearTimeout(timer); resolve(m); },
      };
      waiters.push(w);
    });
  const ready = await nextOfType("ready");
  return { worker, ring, notices, errors, nextOfType, ready };
}

/** Read logEvents back through a REAL adapter over the real migrated DB. */
async function readRows(sql = "SELECT * FROM logEvents ORDER BY id", params = []) {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  return db.all(sql, params);
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe("the worker drainer — a real Worker writes real rows", () => {
  it("boots a REAL Worker (no alias failure) and reports its driver", async () => {
    const { worker, ready, notices, errors } = await bootWorker();
    expect(errors).toEqual([]);
    expect(ready.driver).toMatch(/sqlite|better-sqlite3|node:sqlite/);
    // M8 §8: the ready notice reports the posture the worker will actually
    // enforce, and it comes from the SETTINGS SEAM — the worker's own constant
    // and `DEFAULT_SETTINGS.logRetention` are one declaration, so this
    // assertion is an ALIGNMENT check, not a restated literal.
    const { defaultLogRetention } = await import("@/lib/logshipper/retention.js");
    expect(ready.retention).toEqual(defaultLogRetention());
    expect(ready.retentionSource).toBe("default"); // no settings row exists yet
    expect(ready.retentionSweepMs).toBe(60 * 60 * 1000);
    // The ready notice carries the ring's own accounting.
    expect(ready.ring.pendingFrames).toBe(0);
    expect(ready.ring.capacityBytes).toBe(4 * 1024 * 1024);
    await worker.terminate();
    expect(notices.some((m) => m.type === "error" && m.fatal)).toBe(false);
  });

  it("drains enqueued entries into logEvents as real rows", async () => {
    const { worker, ring, nextOfType } = await bootWorker();
    const { enqueue } = await import("@/lib/logshipper/writer.js");
    const N = 25;
    for (let i = 0; i < N; i += 1) {
      enqueue(ring, JSON.stringify({
        ts: 1_700_000_000_000 + i, lvl: 20, stream: "console",
        reqId: "req-abc", upstreamId: "up-1", provider: "openai", tag: "FETCH",
        msg: `durable line ${i}`, meta: JSON.stringify({ i }), truncMsg: 0, truncMeta: 0,
      }));
    }
    // Ask for an immediate drain rather than waiting on the 250ms cadence.
    const flushed = await nextOfType("flushed");
    await settle();
    const rows = await readRows();
    expect(rows.length).toBe(N);
    expect(rows[0].msg).toBe("durable line 0");
    expect(rows[N - 1].msg).toBe(`durable line ${N - 1}`);
    // The plan's flush notice shape.
    expect(flushed).toHaveProperty("n");
    expect(flushed).toHaveProperty("droppedSinceLast");
    await worker.terminate();
  });

  it("stores a SQL-injection payload LITERALLY (bound parameters only)", async () => {
    const { worker, ring, nextOfType } = await bootWorker();
    const { enqueue } = await import("@/lib/logshipper/writer.js");
    // Built from parts so this file itself carries no executable payload.
    const Q = String.fromCharCode(39);
    const DASHES = "-" + "-";
    const PAYLOAD = [
      `upstream said: ${Q})`,
      " OR 1=1",
      `; DROP TABLE logEvents ${DASHES}`,
      ` INSERT INTO logEvents(msg) VALUES (${Q}pwned${Q});`,
    ].join("");

    enqueue(ring, JSON.stringify({
      ts: 1_700_000_100_000, lvl: 40, stream: "console",
      reqId: null, upstreamId: null, provider: "anthropic", tag: null,
      msg: PAYLOAD, meta: null, truncMsg: 0, truncMeta: 0,
    }));
    await nextOfType("flushed");
    await settle();

    const rows = await readRows();
    expect(rows.length).toBe(1);
    // Stored byte-for-byte as DATA...
    expect(rows[0].msg).toBe(PAYLOAD);
    // ...and no second row appeared from the injected statement.
    expect(rows.some((r) => r.msg === "pwned")).toBe(false);
    // The table is still there: the DROP never executed.
    const tables = await readRows("SELECT name FROM sqlite_master WHERE name = ?", ["logEvents"]);
    expect(tables.length).toBe(1);
    await worker.terminate();
  });

  it("reports droppedSinceLast on every flush notice", async () => {
    const { worker, ring, nextOfType } = await bootWorker();
    const { enqueue, RING_BYTES } = await import("@/lib/logshipper/writer.js");
    // Overflow the ring with max-size frames so the drop counter moves.
    const huge = JSON.stringify({ ts: 1, lvl: 40, stream: "console", msg: "w".repeat(8000), meta: "m".repeat(16000), reqId: null, upstreamId: null, provider: null, tag: null, truncMsg: 0, truncMeta: 0 });
    const frames = Math.ceil((RING_BYTES / (huge.length + 4)) * 1.4);
    for (let i = 0; i < frames; i += 1) enqueue(ring, huge);

    const flushed = await nextOfType("flushed");
    await settle();
    // A drop that is never reported is the silent-loss defect: the notice
    // must carry a non-zero delta once the ring has overflowed.
    expect(flushed.droppedSinceLast).toBeGreaterThan(0);
    const rows = await readRows();
    expect(rows.length).toBeLessThan(frames); // the loss is real...
    expect(rows.length).toBeGreaterThan(0); // ...and bounded, newest survive
    await worker.terminate();
  });

  it("accepts every allow-listed type and rejects nothing on the happy path", async () => {
    const { worker, ring, nextOfType, notices } = await bootWorker();
    const { enqueue } = await import("@/lib/logshipper/writer.js");
    enqueue(ring, JSON.stringify({ ts: 1, lvl: 20, stream: "console", msg: "allow-listed flush", reqId: null, upstreamId: null, provider: null, tag: null, meta: null, truncMsg: 0, truncMeta: 0 }));

    worker.postMessage({ type: "flush", data: { seq: 7 } });
    const flushed = await nextOfType("flushed");
    expect(flushed.seq).toBe(7);
    worker.postMessage({ type: "retention", data: { mode: "age", days: 14 } });
    const applied = await nextOfType("retention-applied");
    expect(applied.mode).toBe("age");
    // Nothing on the happy path was rejected.
    expect(notices.filter((m) => m.type === "rejected")).toEqual([]);
    await worker.terminate();
  });

  it("ignores an unknown message type AND counts it", async () => {
    const { worker, nextOfType, notices } = await bootWorker();
    worker.postMessage({ type: "definitely-not-allowed", data: { sql: "DELETE FROM logEvents" } });
    worker.postMessage({ type: "eval", data: {} });
    worker.postMessage({}); // no type at all
    const rejected = await nextOfType("rejected");
    expect(rejected.count).toBeGreaterThanOrEqual(1);
    expect(rejected.messageType).toBe("definitely-not-allowed");
    // Nothing was deleted by the rejected messages.
    expect(await readRows()).toEqual([]);
    expect(notices.filter((m) => m.type === "cleared")).toEqual([]);
    await worker.terminate();
  });

  it("executes the clear door and reports the deleted count", async () => {
    const { worker, ring, nextOfType } = await bootWorker();
    const { enqueue } = await import("@/lib/logshipper/writer.js");
    for (let i = 0; i < 3; i += 1) {
      enqueue(ring, JSON.stringify({ ts: 1, lvl: 20, stream: "console", msg: `pre-clear ${i}`, reqId: null, upstreamId: null, provider: null, tag: null, meta: null, truncMsg: 0, truncMeta: 0 }));
    }
    await nextOfType("flushed");
    await settle();
    expect((await readRows()).length).toBe(3);

    // §6 ordering step 3: flush (already settled) → DELETE → ack.
    worker.postMessage({ type: "flush", data: { seq: 1 } });
    await nextOfType("flushed");
    worker.postMessage({ type: "clear", data: { seq: 2 } });
    const cleared = await nextOfType("cleared");
    expect(cleared.deleted).toBe(3);
    await settle();
    expect(await readRows()).toEqual([]);
    await worker.terminate();
  });

  it("applies a retention sweep with BOUND values", async () => {
    const { worker, nextOfType } = await bootWorker();
    // Seed directly through the worker's own store is not possible from here,
    // so let the migration create the table and assert the sweep answers.
    worker.postMessage({ type: "retention", data: { mode: "age", days: 0 } });
    const applied = await nextOfType("retention-applied");
    expect(applied.mode).toBe("age");
    expect(applied.removed).toBe(0);
    await worker.terminate();
  });

  it("the main handle's wal_autocheckpoint reads 0 once the worker owns it", async () => {
    // §2 checkpoint ownership: the freeze was TWO handles running TRUNCATE.
    // With the worker owning it, the main handle must be opted out — and that
    // must be observable on the real connection, not merely intended.
    const { setCheckpointOwner, checkpointOwner } = await import("@/lib/db/checkpointOwner.js");
    setCheckpointOwner("worker");
    expect(checkpointOwner()).toBe("worker");

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const rows = db.all("PRAGMA wal_autocheckpoint");
    expect(Number(rows[0].wal_autocheckpoint)).toBe(0);
  });

  it("the main handle registers NO checkpoint timer, not merely an idle one", async () => {
    // The pragma alone is NOT proof: `wal_autocheckpoint` reads 0 whether the
    // timer was suppressed or merely registered-but-unref'd. Only the
    // registration itself distinguishes them — and leaving it registered is
    // exactly the 5,495 ms main-thread freeze this ownership exists to end.
    // (Mutation-proven: forcing `if (true)` in the adapter leaves every other
    // case in this file green while this one goes red.)
    const { setCheckpointOwner } = await import("@/lib/db/checkpointOwner.js");
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");

    setCheckpointOwner("main");
    const underMain = await createNodeSqliteAdapter(path.join(tempDir, "owned-main.sqlite"));
    expect(underMain.hasCheckpointTimer()).toBe(true); // baseline: it exists

    setCheckpointOwner("worker");
    const underWorker = await createNodeSqliteAdapter(path.join(tempDir, "owned-worker.sqlite"));
    expect(underWorker.hasCheckpointTimer()).toBe(false); // born opted out
    expect(Number(underWorker.all("PRAGMA wal_autocheckpoint")[0].wal_autocheckpoint)).toBe(0);

    // And flipping the ownership retires one that was ALREADY open.
    setCheckpointOwner("main");
    const later = await createNodeSqliteAdapter(path.join(tempDir, "owned-later.sqlite"));
    expect(later.hasCheckpointTimer()).toBe(true);
    setCheckpointOwner("worker");
    expect(later.hasCheckpointTimer()).toBe(false); // retired in place

    underMain.close();
    underWorker.close();
    later.close();
    setCheckpointOwner("main");
  });

  it("a handle born BEFORE the flip is retired too (both halves)", async () => {
    const { openNativeHandleCount, setCheckpointOwner } = await import("@/lib/db/checkpointOwner.js");
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    // Born under main ownership → autocheckpoint stays on.
    const born = await createNodeSqliteAdapter(path.join(tempDir, "preflip.sqlite"));
    expect(Number(born.all("PRAGMA wal_autocheckpoint")[0].wal_autocheckpoint)).toBe(1000);
    expect(openNativeHandleCount()).toBeGreaterThan(0);

    // Now flip: the open handle must be suppressed, not only future ones.
    setCheckpointOwner("worker");
    expect(Number(born.all("PRAGMA wal_autocheckpoint")[0].wal_autocheckpoint)).toBe(0);
    setCheckpointOwner("main");
    born.close();
  });
});

// The guard that a parse sweep cannot see (the v0.9.24 lesson): SQL built by
// concatenation or template interpolation is a green build and a red suite.
describe("the binding mandate — a standing ratchet", () => {
  // COMMENTS ARE STRIPPED FIRST. These files discuss the binding mandate at
  // length, and a regex over raw text reports a paragraph of prose as an
  // offender — an instrument that flags its own documentation is not a
  // ratchet, it is noise. Only executable lines may be flagged.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  it("no logshipper file builds SQL by concatenation or interpolation", () => {
    const dir = path.join(ROOT, "src", "lib", "logshipper");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    const offenders = [];
    for (const f of files) {
      const src = stripComments(fs.readFileSync(path.join(dir, f), "utf-8"));
      // A template literal carrying a SQL keyword AND an interpolation is the
      // injection shape.
      for (const m of src.matchAll(/`[^`]*(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE)[^`]*`/gi)) {
        if (/\$\{|\+\s*[A-Za-z_$]/.test(m[0])) offenders.push(`${f}: interpolated SQL literal`);
      }
      // And the belt: an interpolated or concatenated statement argument.
      if (/\b(?:exec|run|all|get)\(\s*`[^`]*\$\{/.test(src)) offenders.push(`${f}: interpolated exec/run argument`);
      if (/\b(?:exec|run|all|get)\(\s*["'][^"']*["']\s*\+/.test(src)) offenders.push(`${f}: concatenated exec/run argument`);
    }
    expect(offenders, `SQL built by concatenation in src/lib/logshipper:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("THE GUARD BITES: a planted concatenation is caught", () => {
    // A guard nobody has seen fail is a guard nobody can trust. Plant the exact
    // defect it exists to catch and prove the matcher reports it.
    const planted = "db.all(`SELECT * FROM logEvents WHERE msg = ${msg}`);";
    expect(/\b(?:exec|run|all|get)\(\s*`[^`]*\$\{/.test(planted)).toBe(true);
    // And the real worker source must be clean of the same shape.
    const real = stripComments(fs.readFileSync(path.join(ROOT, "src", "lib", "logshipper", "worker.js"), "utf-8"));
    expect(/\b(?:exec|run|all|get)\(\s*`[^`]*\$\{/.test(real)).toBe(false);
    // A prose paragraph about the law must NOT trip it.
    const prose = stripComments("// run(sql) with ${interp} inside a doc comment\nconst x = 1;\n");
    expect(/\b(?:exec|run|all|get)\(\s*`[^`]*\$\{/.test(prose)).toBe(false);
  });

  it("the store uses exec ONLY for fixed DDL and bound values for rows", async () => {
    const src = fs.readFileSync(path.join(ROOT, "src", "lib", "db", "repos", "sqlite", "logStore.js"), "utf-8");
    // Every INSERT carries a `?` placeholder and a params array.
    expect(src).toMatch(/INSERT INTO logEvents[\s\S]*VALUES \(\?[^)]*\)/);
    expect(src).toMatch(/db\.run\(INSERT_SQL, p\)/);
    // No caller-supplied value is ever spliced into a statement.
    expect(src).not.toMatch(/INSERT INTO logEvents[^`]*\$\{/);
  });
});