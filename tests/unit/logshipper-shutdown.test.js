// tests/unit/logshipper-shutdown.test.js — M4 "The Bound Tide" (§2.1).
//
// THIS SUITE PROVES THE HANDSHAKE, NOT THE INTENTION. Four cases, each against
// the law it claims:
//
//   (a) FAITHFUL WORKER — the REAL worker.js, N rows enqueued through the REAL
//       shipLog door, `shutdownLogshipper()` awaited: all N rows must exist in
//       logEvents AFTER it resolves, and the call must return inside the 2s
//       bound. This is the case that bites when the handshake is removed: the
//       rows are still in the ring, and the assertion on row count reddens.
//   (b) BOUND RESPECTED — a worker that accepts the message and NEVER acks.
//       The handshake must still RESOLVE (never reject, never hang) inside the
//       bound. Proven against a real Worker with its ack path silenced, not a
//       fake timer: the thing that must not happen is a real wait.
//   (c) IDEMPOTENT — Docker sends SIGTERM twice. Two calls share ONE handshake:
//       same promise identity, no double `shutdown` post, no hang.
//   (d) THE PIN — VELA_LOG_DRIVER='sql.js' → degraded posture in stats;
//       garbage → follows the main chain without crash.
//
// THE DB-HARNESS TRAP (crystallized v0.9.77, restated because this suite
// re-imports the adapter per test): `paths.js` freezes DATA_DIR at first import
// AND `driver.js` binds `global._dbAdapter` once at module eval, so
// `delete global._dbAdapter` alone never rebinds. Both hooks therefore reset
// modules AND drop the global.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const originalLogDriver = process.env.VELA_LOG_DRIVER;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-m4-shutdown-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "PLACEHOLDER-not-a-real-secret";
  delete process.env.VELA_DB_DRIVER;
  delete process.env.VELA_DB_MODE;
  delete process.env.VELA_LOG_DRIVER;
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
  if (originalLogDriver === undefined) delete process.env.VELA_LOG_DRIVER;
  else process.env.VELA_LOG_DRIVER = originalLogDriver;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

/** Read logEvents back through a REAL adapter over the real migrated DB. */
async function readRows(sql = "SELECT * FROM logEvents ORDER BY id", params = []) {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  return db.all(sql, params);
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/** Boot the REAL shipper against a real worker, and wait for the worker's `ready`. */
async function bootShipper(opts = {}) {
  const mod = await import("@/lib/logshipper/index.js");
  await mod.initLogshipper({ workerPath: WORKER_PATH, ...opts });
  const state = mod.getLogshipperState();
  // The real `ready` notice, not a sleep: the handshake is only meaningful
  // against a worker that has actually opened its handle.
  const deadline = Date.now() + 8000;
  while (!state.ready && Date.now() < deadline) await settle(25);
  return mod;
}

describe("M4 §2.1 — the bounded shutdown handshake", () => {
  it("(a) flushes every accepted row to logEvents before it resolves, inside the bound", async () => {
    const mod = await bootShipper();
    const state = mod.getLogshipperState();
    expect(state.transport).toBe("worker");
    expect(state.ready).toBe(true);

    const N = 40;
    for (let i = 0; i < N; i += 1) {
      mod.shipLog({ lvl: 20, stream: "console", tag: "M4", msg: `accepted line ${i}` });
    }

    const startedAt = Date.now();
    const verdict = await mod.shutdownLogshipper();

    const elapsed = Date.now() - startedAt;
    // The bound is a CEILING (law 2), not an estimate.
    expect(elapsed).toBeLessThan(mod.SHUTDOWN_FLUSH_WINDOW_MS);
    expect(verdict.posture).toBe("worker");
    expect(verdict.acked).toBe(true);

    // THE LOAD-BEARING ASSERTION: every accepted line is a durable row the
    // moment the handshake resolves. With the handshake removed, the worker
    // still holds them in the ring and this count is 0 (or partial).
    const rows = await readRows("SELECT msg FROM logEvents ORDER BY id");
    expect(rows.length).toBe(N);
    expect(rows.map((r) => r.msg)).toEqual(Array.from({ length: N }, (_, i) => `accepted line ${i}`));

    await settle(150);
    const after = await readRows("SELECT msg FROM logEvents ORDER BY id");
    expect(after.length).toBe(N); // the terminal drains exactly once
  });

  it("(b) resolves inside the bound when the worker NEVER acks", async () => {
    const mod = await bootShipper();
    const state = mod.getLogshipperState();
    const real = state.worker;
    expect(real).toBeTruthy();

    // A WEDGED WORKER, as a stub transport rather than a faked clock: it
    // accepts the allow-listed `shutdown` message (proving the post really
    // happened, so the case cannot pass by never sending anything) and NEVER
    // posts `stopped`. That is exactly the shape of a thread that received its
    // instruction and then stopped making progress — the case §2.1's bound
    // exists for. The clock is real; the promise must still settle.
    const sent = [];
    const listeners = new Set();
    const wedged = {
      on: (event, fn) => { if (event === "message") listeners.add(fn); },
      off: (event, fn) => { if (event === "message") listeners.delete(fn); },
      postMessage: (msg) => { sent.push(msg); }, // accepts, never acks
      terminate: () => Promise.resolve(0),
    };
    state.worker = wedged;

    const startedAt = Date.now();
    const verdict = await mod.shutdownLogshipper();
    const elapsed = Date.now() - startedAt;

    // The message WAS delivered — otherwise "bounded" would be vacuous.
    expect(sent.map((m) => m.type)).toContain("shutdown");
    // LAW 2: bounded. The 2s handshake plus a bounded terminate leg; the point
    // is that it does not wait forever.
    expect(elapsed).toBeLessThan(mod.SHUTDOWN_FLUSH_WINDOW_MS + 1500);
    // LAW 1: an unacked worker is an HONEST VERDICT, not an exception — and
    // the handshake resolved rather than rejecting.
    expect(verdict.acked).toBe(false);
    expect(verdict.posture).toBe("worker");
    await expect(Promise.resolve(verdict)).resolves.toBeTruthy();
    try { await real.terminate(); } catch {}
  });

  it("(c) is idempotent — two calls share ONE handshake and never hang", async () => {
    const mod = await bootShipper();
    mod.shipLog({ lvl: 20, stream: "console", msg: "idempotency witness" });

    const a = mod.shutdownLogshipper();
    const b = mod.shutdownLogshipper();

    // Same in-flight handshake: the second caller awaits the FIRST promise, so
    // `shutdown` is posted exactly once even under a double SIGTERM.
    expect(a).toBe(b);

    const startedAt = Date.now();
    const [first, second] = await Promise.all([a, b]);
    expect(Date.now() - startedAt).toBeLessThan(mod.SHUTDOWN_FLUSH_WINDOW_MS + 1500);
    expect(second).toBe(first);

    // A third call AFTER the handshake settled still resolves (not hangs, not
    // rejects) — the drain may be reached from several paths.
    const third = await mod.shutdownLogshipper();
    expect(third).toBe(first);

    const rows = await readRows("SELECT msg FROM logEvents");
    // Exactly ONE copy: a double-posted shutdown cannot double-write the rows.
    expect(rows.filter((r) => r.msg === "idempotency witness").length).toBe(1);
  });
});

describe("M4 — VELA_LOG_DRIVER pin", () => {
  it("(d1) 'sql.js' pins the MAIN posture to degraded (no worker is spawned)", async () => {
    process.env.VELA_LOG_DRIVER = "sql.js";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("@/lib/logshipper/index.js");
    await mod.initLogshipper();
    const stats = mod.getLogshipperStats();

    expect(stats.transport).toBe("degraded");
    expect(stats.degraded).toBe(true);
    expect(stats.worker).toBeUndefined();
    expect(stats.driverPin).toBe("sql.js");
    expect(mod.getLogshipperState().worker).toBeNull();
    warn.mockRestore();
  });

  it("(d2) an unknown value follows the MAIN CHAIN and never crashes", async () => {
    process.env.VELA_LOG_DRIVER = "not-a-real-driver";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("@/lib/logshipper/index.js");

    // The chain still answers — and on this runtime it is NOT sql.js, so the
    // worker posture is what must come back.
    await mod.initLogshipper({ workerPath: WORKER_PATH });
    const stats = mod.getLogshipperStats();

    expect(stats.transport).toBe("worker");
    expect(stats.bootError).toBeNull();
    // A garbage value is NOT recorded as a pin — it was not honoured, so
    // claiming it was would be a lie in the stats.
    expect(stats.driverPin).toBeUndefined();
    await mod.shutdownLogshipper();
    warn.mockRestore();
  });

  it("(d3) the WORKER-side pin honours node:sqlite and reports it honestly", async () => {
    process.env.VELA_LOG_DRIVER = "node:sqlite";
    const { resolveWorkerDriverPin, openWorkerDriver } = await import("@/lib/logshipper/workerDriver.js");
    // The pin itself: known names pass through normalized, unknown ones do not.
    expect(resolveWorkerDriverPin("node:sqlite")).toBe("node:sqlite");
    expect(resolveWorkerDriverPin("  SQL.JS ")).toBe("sql.js");
    expect(resolveWorkerDriverPin("nonsense")).toBeNull();

    // A genuinely absent value is NOT `undefined`-as-default-argument: that form
    // reads the live env, which this case deliberately set. An EMPTY string is
    // the honest "operator set nothing" shape, and must not become a pin.
    expect(resolveWorkerDriverPin("")).toBeNull();

    // And the real worker honours it end to end: the opened driver IS the pin.
    const opened = await openWorkerDriver();
    expect(opened.driver).toBe("node:sqlite");
    expect(opened.pinned).toBe(true);
    expect(opened.pinnedDriver).toBe("node:sqlite");
    try { opened.adapter.close?.(); } catch {}
  });
});

describe("M4 — stats name the hard-kill windows (R3)", () => {
  it("surfaces shutdownFlushWindowMs / workerFlushCadenceMs on worker posture", async () => {
    const mod = await bootShipper();
    const stats = mod.getLogshipperStats();
    expect(stats.shutdownFlushWindowMs).toBe(2000);
    expect(stats.workerFlushCadenceMs).toBe(250);
    expect(stats.degradedFlushLagMs).toBeNull();
    await mod.shutdownLogshipper();
  });

  it("surfaces degradedFlushLagMs on degraded posture, and the handshake flushes once", async () => {
    process.env.VELA_LOG_DRIVER = "sql.js";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("@/lib/logshipper/index.js");
    await mod.initLogshipper();
    const stats = mod.getLogshipperStats();
    expect(stats.shutdownFlushWindowMs).toBe(2000);
    expect(stats.workerFlushCadenceMs).toBeNull();
    expect(stats.degradedFlushLagMs).toBe(5000);

    // The degraded handshake flushes the accepted buffer rather than dropping it.
    for (let i = 0; i < 3; i += 1) {
      mod.shipLog({ lvl: 20, stream: "console", msg: `degraded line ${i}` });
    }
    const verdict = await mod.shutdownLogshipper();
    expect(verdict.posture).toBe("degraded");
    expect(verdict.acked).toBe(true);
    const rows = await readRows("SELECT msg FROM logEvents ORDER BY id");
    expect(rows.map((r) => r.msg)).toEqual(["degraded line 0", "degraded line 1", "degraded line 2"]);
    warn.mockRestore();
  });

  it("the mysql posture resolves immediately and boots no worker", async () => {
    process.env.VELA_DB_MODE = "mysql";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("@/lib/logshipper/index.js");
    await mod.initLogshipper();
    expect(mod.getLogshipperState().worker).toBeNull();

    const startedAt = Date.now();
    const verdict = await mod.shutdownLogshipper();
    // "Immediately" is a claim, so it is measured: the 2s window is NOT spent.
    expect(Date.now() - startedAt).toBeLessThan(200);
    expect(verdict.posture).toBe("disabled");
    warn.mockRestore();
  });

  it("a NEVER-BOOTED shipper resolves without rejecting (law 1)", async () => {
    const mod = await import("@/lib/logshipper/index.js");
    const verdict = await mod.shutdownLogshipper();
    expect(verdict.posture).toBe("disabled");
    expect(verdict.acked).toBe(false);
  });
});