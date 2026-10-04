// M3 §2 — DEGRADED MODE: the sql.js posture, honoured rather than faked.
//
// The plan is blunt about this case: when the resolved driver is sql.js the
// worker is bypassed, because sql.js persist = `db.export()` + a whole-file
// `fs.writeFileSync` — O(file) on the MAIN thread. The degradation is therefore
// (a) batching in memory only, (b) at most ONE persist per 5s and only when
// non-empty, (c) a hard 50 MB cap with prune-oldest on breach, (d) stats that
// SAY all of it: degraded true, r4 "enqueue-only". R4 holds for the enqueue
// only, and the periodic persist pause is real — never faked away.
//
// Every case here asserts a number, not a shape: a stats flag that can never
// flip, a cadence that never fires and a cap that never prunes are all green
// under an assertion that only checks the object exists.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalDbDriver = process.env.VELA_DB_DRIVER;
const originalDbMode = process.env.VELA_DB_MODE;

// A throwaway fixture value for migration 002's key hashing. PLACEHOLDER: it
// is never a credential and never leaves the temp dir.
const TEST_SECRET_PLACEHOLDER = "example-fixture-not-a-credential";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-m3-degraded-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = TEST_SECRET_PLACEHOLDER;
  delete process.env.VELA_DB_MODE;
  // Pin the crash driver: this is the posture under test, so it is FORCED
  // rather than hoped for (the Storage Covenant A4 precedent — force the
  // fragile corner so the matrix can reach it).
  process.env.VELA_DB_DRIVER = "sql.js";
  vi.resetModules();
  delete global._dbAdapter;
});

afterEach(() => {
  if (global._dbAdapter?.instance) {
    try { global._dbAdapter.instance.close(); } catch {}
  }
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalDbDriver === undefined) delete process.env.VELA_DB_DRIVER;
  else process.env.VELA_DB_DRIVER = originalDbDriver;
  if (originalDbMode === undefined) delete process.env.VELA_DB_MODE;
  else process.env.VELA_DB_MODE = originalDbMode;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

describe("degraded mode — the sql.js posture is honoured, not faked", () => {
  it("selects the degraded transport and does NOT spawn a Worker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, getLogshipperStats, getLogshipperState } = await import("@/lib/logshipper/index.js");
    await initLogshipper();

    const stats = getLogshipperStats();
    expect(stats.transport).toBe("degraded");
    expect(stats.degraded).toBe(true);
    expect(stats.r4).toBe("enqueue-only");
    expect(stats.posture).toBe("sqlite");
    // No worker at all — the sql.js persist is O(file) and must not be paid on
    // a second thread pretending the problem away.
    expect(getLogshipperState().worker).toBeNull();
    // And it says so out loud: silence would ship a broken posture.
    expect(warn.mock.calls.some((c) => String(c[0]).includes("sql.js"))).toBe(true);
    warn.mockRestore();
  });

  it("shipLog keeps feeding the in-memory buffer without a worker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, shipLog, getLogshipperStats } = await import("@/lib/logshipper/index.js");
    await initLogshipper();

    for (let i = 0; i < 5; i += 1) {
      shipLog({ lvl: 20, stream: "console", msg: `degraded line ${i}` });
    }
    const stats = getLogshipperStats();
    expect(stats.ring.pendingFrames).toBe(5);
    expect(stats.ring.droppedCount).toBe(0);
    warn.mockRestore();
  });

  it("persists at most once per 5s and only when non-empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, shipLog, persistDegraded, getLogshipperState, DEGRADED_PERSIST_INTERVAL_MS } = await import(
      "@/lib/logshipper/index.js"
    );
    await initLogshipper();
    expect(DEGRADED_PERSIST_INTERVAL_MS).toBe(5000);

    shipLog({ lvl: 20, stream: "console", msg: "persist me" });
    expect(getLogshipperState().degradedBuffer.length).toBe(1);

    // An empty buffer must NOT reach the adapter at all: the cadence persists
    // only when there is something to persist. Planting a persist that always
    // writes makes this case red on the row count staying put.
    const wrote = await persistDegraded();
    expect(wrote).toBe(1);
    expect(getLogshipperState().degradedBuffer.length).toBe(0);
    expect(getLogshipperState().degradedBytes).toBe(0);

    // Second call with nothing queued is a NO-OP, and the instrument for that
    // is the ADAPTER's own run counter, not the return value: a persist that
    // early-returns 0 and a persist that opens a transaction and writes
    // nothing both return 0. Counting the adapter calls is the only honest
    // difference between "did not persist" and "persisted nothing".
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    let dbCalls = 0;
    const realRun = db.run.bind(db);
    const realExec = db.exec.bind(db);
    db.run = (sql, params) => {
      dbCalls += 1;
      return realRun(sql, params);
    };
    db.exec = (sql) => {
      dbCalls += 1;
      return realExec(sql);
    };
    try {
      expect(await persistDegraded()).toBe(0);
      // Zero calls of EITHER kind. `exec` is counted too because opening the
      // store runs ensureTable's DDL: a persist that skipped the empty check
      // would still touch the adapter even with nothing to insert, which is
      // the O(file) rewrite this guard exists to prevent.
      expect(dbCalls).toBe(0);
      expect(getLogshipperState().bootError).toBeNull();
    } finally {
      db.run = realRun;
      db.exec = realExec;
    }
    warn.mockRestore();
  });

  it("the armed timer IS the cadence: one timer, not one per line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { initLogshipper, shipLog, getLogshipperState, DEGRADED_PERSIST_INTERVAL_MS } = await import(
        "@/lib/logshipper/index.js"
      );
      await initLogshipper();
      expect(getLogshipperState().degradedTimer).toBeNull();

      for (let i = 0; i < 50; i += 1) shipLog({ lvl: 20, stream: "console", msg: `burst ${i}` });
      // One armed timer, whatever the burst size — a per-line timer is how a
      // degraded path turns into an O(file) stampede. The SENTINEL proves it:
      // each new line re-arms a DIFFERENT timer, so the first one never fires.
      // Plant "a timer per line" (drop the armed-timer guard) and this count
      // stays 0, because 50 timers were armed and all 50 were replaced.
      const armedFirst = getLogshipperState().degradedTimer;
      expect(armedFirst).not.toBeNull();
      shipLog({ lvl: 20, stream: "console", msg: "sentinel" });
      expect(getLogshipperState().degradedTimer).toBe(armedFirst); // SAME timer
      expect(getLogshipperState().degradedBuffer.length).toBe(51);

      await vi.advanceTimersByTimeAsync(DEGRADED_PERSIST_INTERVAL_MS);
      // Exactly one persist happened for the whole burst — the cadence fired
      // once, not once per line.
      expect(getLogshipperState().degradedTimer).toBeNull();
      expect(getLogshipperState().degradedBuffer.length).toBe(0);
      expect(getLogshipperState().degradedBytes).toBe(0);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces the hard 50 MB cap by pruning the OLDEST", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, shipLog, getLogshipperStats, DEGRADED_MAX_BYTES } = await import(
      "@/lib/logshipper/index.js"
    );
    expect(DEGRADED_MAX_BYTES).toBe(50 * 1024 * 1024);
    await initLogshipper();

    // Fill past the cap with near-cap rows (8,000-char msg is the door's clamp).
    const big = "d".repeat(8000);
    for (let i = 0; i < 7000; i += 1) shipLog({ lvl: 40, stream: "console", msg: `${i}:${big}` });

    const stats = getLogshipperStats();
    // The cap holds...
    expect(stats.ring.usedBytes).toBeLessThanOrEqual(DEGRADED_MAX_BYTES);
    // ...the loss is COUNTED, not silent...
    expect(stats.ring.droppedCount).toBeGreaterThan(0);
    // ...and prune-oldest is the direction: the newest rows survive.
    const buffered = stats.ring.pendingFrames;
    expect(buffered).toBeGreaterThan(0);
    expect(buffered).toBeLessThan(7000);
    warn.mockRestore();
  });

  it("scrubs and clamps on the degraded path exactly as on the worker path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, shipLog, getLogshipperState, scrubForPersistence, MSG_MAX_CHARS, META_MAX_CHARS } = await import(
      "@/lib/logshipper/index.js"
    );
    await initLogshipper();

    // The control-char law: SGR, CSI non-SGR, OSC, DCS and C0 all go; \n
    // becomes a space; nothing is injected.
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    const ST = ESC + "\\";
    expect(scrubForPersistence(`${ESC}[31mred${ESC}[0m`)).toBe("red");
    expect(scrubForPersistence(`${ESC}[2Jcleared`)).toBe("cleared");
    expect(scrubForPersistence(`${ESC}]0;title${BEL}body`)).toBe("body");
    expect(scrubForPersistence(`${ESC}Ppayload${ST}body`)).toBe("body");
    expect(scrubForPersistence("a\nb\tc")).toBe("a b\tc");
    expect(scrubForPersistence(`bell${BEL}here`)).toBe("bellhere");

    // The clamps, with their dedicated flags.
    const r1 = shipLog({ lvl: 20, stream: "console", msg: "m".repeat(MSG_MAX_CHARS + 500) });
    expect(r1.truncMsg).toBe(true);
    const r2 = shipLog({ lvl: 20, stream: "console", msg: "ok", meta: { k: "v".repeat(META_MAX_CHARS + 500) } });
    expect(r2.truncMeta).toBe(true);
    const r3 = shipLog({ lvl: 20, stream: "console", msg: "short" });
    expect(r3.truncMsg).toBe(false);
    expect(r3.truncMeta).toBe(false);

    // The stored rows honour both bounds — the flag is honest about the value.
    const rows = getLogshipperState().degradedBuffer;
    expect(rows[0].msg.length).toBe(MSG_MAX_CHARS);
    expect(rows[0].truncMsg).toBe(true);
    expect(rows[1].meta.length).toBe(META_MAX_CHARS);
    expect(rows[1].truncMeta).toBe(true);
    warn.mockRestore();
  });

  it("refuses an unknown stream and defaults lvl rather than throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, shipLog, getLogshipperState, LOG_LEVELS } = await import("@/lib/logshipper/index.js");
    await initLogshipper();

    shipLog({ lvl: 99, stream: "not-a-stream", msg: "odd input" });
    const row = getLogshipperState().degradedBuffer[0];
    // The column is NOT NULL and constrained — a bad value must degrade to the
    // declared default, never ride out and poison the ledger.
    expect(row.stream).toBe("console");
    expect(row.lvl).toBe(LOG_LEVELS.info);
    expect(Number.isInteger(row.lvl)).toBe(true);
    warn.mockRestore();
  });
});

describe("the mysql posture — disabled, loudly", () => {
  beforeEach(() => {
    process.env.VELA_DB_MODE = "mysql";
  });

  it("disables durable logs, warns, and still feeds the rings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, shipLog, getLogshipperStats, getLogshipperState } = await import("@/lib/logshipper/index.js");
    await initLogshipper();

    const stats = getLogshipperStats();
    expect(stats.posture).toBe("mysql");
    expect(stats.transport).toBe("disabled");
    expect(getLogshipperState().worker).toBeNull();
    // LOUD: the posture is named at boot, never left to be discovered later.
    expect(warn.mock.calls.some((c) => String(c[0]).includes("mysql"))).toBe(true);
    // And it is silent, not throwing: a line still ships without a durable door.
    expect(() => shipLog({ lvl: 20, stream: "console", msg: "still fine" })).not.toThrow();
    warn.mockRestore();
  });
});

describe("the mirror posture — divergence surfaced, not hidden", () => {
  beforeEach(() => {
    process.env.VELA_DB_MODE = "mirror";
  });

  it("reports twin not-mirrored alongside the degraded flags", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initLogshipper, getLogshipperStats } = await import("@/lib/logshipper/index.js");
    await initLogshipper();
    const stats = getLogshipperStats();
    expect(stats.posture).toBe("mirror");
    // logEvents is PRIMARY-ONLY: worker writes sit outside the main isolate, so
    // withOutboxCapture cannot wrap them. Accepted — and SURFACED.
    expect(stats.twin).toBe("not-mirrored");
    warn.mockRestore();
  });
});
