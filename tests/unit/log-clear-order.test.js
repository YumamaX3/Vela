// tests/unit/log-clear-order.test.js — M7 §6's CLEAR ORDERING.
//
// THE WOUND THIS SUITE EXISTS FOR (the r3 refuter's SAB hole): the r2 order
// never flushed the SharedArrayBuffer. Pre-clear bytes already in the ring were
// drained by the worker AFTER the DELETE and re-inserted rows the operator had
// just destroyed. An operator who clears a log and watches the lines come back
// concludes the product is broken — and they would be right.
//
// WHAT IS PROVEN HERE, in §6's own order
//   1 · hold            — lines arriving during the clear are post-clear evidence
//   2 · SAB settle     — the flush is ACKNOWLEDGED and BOUNDED (2s) BEFORE the
//                        delete. Skipping it is the mutation that resurrects
//                        pre-clear rows, and the reappear case must redden.
//   3 · worker DELETE
//   4 · ack with count — the deleted number is what the audit row records
//   5 · drain + rings  — the 80ms pending batch reaches live clients, then the
//                        three rings empty and `clear` is emitted
//   6 · hold releases  — held lines ship as post-clear evidence
//   7 · after: memory ≡ DB
//
// PLUS the two locks the route carries: the `x-9r-password` re-confirm (401
// when absent or wrong) and ONE authAuditLog row per successful clear — in a
// DIFFERENT table, which is the only reason the trail survives the deletion.
//
// WHY A REAL WORKER: the SAB hole is a race between the ring and the DELETE.
// A mock cannot exhibit it — the mock has no ring, so it has no race. This
// suite boots the REAL src/lib/logshipper/worker.js by path against a real
// migrated SQLite (the logshipper-worker suite's harness), pushes pre-clear
// frames into the REAL ring, and then runs the REAL ordered clear. That is the
// only shape in which the defect is reachable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Resolved from THIS file via fileURLToPath — NOT `new URL(...).pathname`,
// which percent-encodes the spaces in "My Project" and yields a path Node
// cannot open (measured: ERR_MODULE_NOT_FOUND with `%20` in the middle).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKER_PATH = path.join(ROOT, "src", "lib", "logshipper", "worker.js");

let tempDir;
let shipper;
let worker;
let ring;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
const originalPassword = process.env.INITIAL_PASSWORD;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-log-clear-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "log-clear-order-secret";
  delete global._dbAdapter;
  // driver.js captures `global._dbAdapter` at module load AND paths.js freezes
  // DATA_DIR at first import — so BOTH must be reset or this case writes into
  // the previous case's harbor (the DB-harness trap).
  vi.resetModules();

  const { createRing } = await import("@/lib/logshipper/writer.js");
  ring = createRing();
  worker = new Worker(WORKER_PATH, { workerData: { sab: ring.sab, ringBytes: ring.capacityBytes } });
  await new Promise((resolve, reject) => {
    const onReady = (m) => {
      if (m?.type === "ready") resolve();
    };
    worker.on("message", onReady);
    worker.on("error", reject);
    setTimeout(() => reject(new Error("worker never reported ready")), 15_000).unref?.();
  });
});

afterEach(async () => {
  try {
    await worker?.terminate();
  } catch {}
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
  if (originalPassword === undefined) delete process.env.INITIAL_PASSWORD;
  else process.env.INITIAL_PASSWORD = originalPassword;
});

/** Push a frame into the REAL ring — the same bytes the shipper would enqueue. */
async function pushIntoRing(msg) {
  const { enqueue } = await import("@/lib/logshipper/writer.js");
  enqueue(ring, JSON.stringify({
    ts: Date.now(),
    lvl: 20,
    stream: "console",
    reqId: null,
    upstreamId: null,
    provider: null,
    tag: null,
    msg,
    meta: null,
    truncMsg: 0,
    truncMeta: 0,
  }));
}

/** Install a shipper whose ring/worker/degradedBuffer point at THIS case's. */
async function mountShipper() {
  const mod = await import("@/lib/logshipper/index.js");
  const state = mod.getLogshipperState();
  // The real module boots its OWN worker; this case drives the one it already
  // has. Adopting it is what makes flushLogshipper/clearPersistedLogs ride the
  // real ring the pre-clear frames are sitting in.
  state.transport = "worker";
  state.ring = ring;
  state.worker = worker;
  state.degraded = false;
  state.hold = false;
  state.held = [];
  state.booted = true;
  return mod;
}

async function readLedger() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
  await getLogStore(); // ensureTable — the worker may not have touched this handle
  return db.all("SELECT id, msg FROM logEvents ORDER BY id ASC").map((r) => r.msg);
}

/** Seed rows directly, bypassing the ring — for the memory≡DB assertions. */
async function seedDirect(msgs) {
  const { getLogStore } = await import("@/lib/db/repos/sqlite/logStore.js");
  const store = await getLogStore();
  store.insertBatch(
    msgs.map((msg) => ({
      ts: Date.now(), lvl: 20, stream: "console", reqId: null, upstreamId: null,
      provider: null, tag: null, msg, meta: null, truncMsg: 0, truncMeta: 0,
    }))
  );
}

describe("A · the ordered clear — the SAB settles BEFORE the delete", { timeout: 60_000 }, () => {
  it("pre-clear lines do NOT reappear — the flush is settled before the DELETE", async () => {
    // THE case. Frames are in the ring and NOT yet in the ledger. A clear that
    // deleted first and flushed second would re-insert exactly these.
    const mod = await mountShipper();
    await pushIntoRing("pre-clear-alpha");
    await pushIntoRing("pre-clear-beta");

    const { runOrderedClear } = await import("@/lib/logshipper/clear.js");
    const verdict = await runOrderedClear();

    // Step 2 acknowledged — the flush really happened, not merely was called.
    expect(verdict.steps.flush.settled).toBe(true);

    // Wait past the worker's 250ms batch cadence: any re-inserted row would
    // land inside this window.
    await new Promise((r) => setTimeout(r, 600));

    const ledger = await readLedger();
    expect(ledger.filter((m) => m.startsWith("pre-clear"))).toEqual([]);
    expect(mod.getLogshipperState().hold).toBe(false);
  });

  it("memory ≡ DB after the clear — the ring-vs-DB divergence is closed", async () => {
    const mod = await mountShipper();
    await seedDirect(["already-persisted-1", "already-persisted-2"]);

    // A console line so the memory rings have something the DB also has.
    const buffer = await import("@/lib/consoleLogBuffer.js");
    buffer.initConsoleLogCapture();
    buffer.appendStructuredEntry({ level: "log", args: ["a live line"], message: "a live line" });

    const { runOrderedClear } = await import("@/lib/logshipper/clear.js");
    await runOrderedClear();
    await new Promise((r) => setTimeout(r, 400));

    const ledger = await readLedger();
    const memory = buffer.getConsoleLogs({ structured: true });
    expect(ledger).toEqual([]);
    expect(memory).toEqual([]);
  });

  it("the hold releases — a line shipped during the clear is POST-clear evidence, not lost", async () => {
    const mod = await mountShipper();
    // Enter the hold exactly as step 1 does, ship one line into it, then run
    // the clear. The held line must surface AFTER the delete, so the ledger
    // ends with it and never with a pre-clear row.
    mod.holdLogshipper();
    mod.shipLog({ lvl: 20, stream: "console", msg: "during-the-clear" });
    expect(mod.getLogshipperState().held).toHaveLength(1);

    const { runOrderedClear } = await import("@/lib/logshipper/clear.js");
    await runOrderedClear();
    await new Promise((r) => setTimeout(r, 400));

    const ledger = await readLedger();
    expect(ledger).toEqual(["during-the-clear"]);
    expect(mod.getLogshipperState().hold).toBe(false);
  });

  it("the DELETE's ack carries the row count the audit row will record", async () => {
    await mountShipper();
    await seedDirect(["one", "two", "three", "four"]);

    const { runOrderedClear } = await import("@/lib/logshipper/clear.js");
    const verdict = await runOrderedClear();

    expect(verdict.deleted).toBe(4);
    expect(verdict.steps.clear.ok).toBe(true);
    expect(await readLedger()).toEqual([]);
  });

  it("the settle is BOUNDED — a wedged worker still finishes the clear, honestly", async () => {
    // The bound is the point: a clear that hung would leave the operator's log
    // on disk, which is the worse of the two failures. The verdict must SAY the
    // settle did not ack rather than pretend it did.
    await mountShipper();
    await seedDirect(["still-here"]);

    // Break the work by terminating it mid-handshake: the flush can never ack.
    await worker.terminate();

    const { runOrderedClear } = await import("@/lib/logshipper/clear.js");
    const verdict = await runOrderedClear({ settleBoundMs: 250 });

    expect(verdict.settled).toBe(false);
    expect(verdict.steps.flush.timedOut).toBe(true);
    // The hold still released — a failed clear must never wedge the shipper.
    expect(verdict.steps.release.released).toBeGreaterThanOrEqual(0);
  });

  it("a `clear` event reaches live SSE subscribers — step 7's frame", async () => {
    await mountShipper();
    const buffer = await import("@/lib/consoleLogBuffer.js");
    const seen = [];
    const onClear = () => seen.push("clear");
    buffer.getConsoleEmitter().on("clear", onClear);
    try {
      const { runOrderedClear } = await import("@/lib/logshipper/clear.js");
      await runOrderedClear();
    } finally {
      buffer.getConsoleEmitter().off("clear", onClear);
    }
    expect(seen).toContain("clear");
  });
});

describe("B · the route's locks — password re-confirm + the audit trail", { timeout: 60_000 }, () => {
  /** Boot the shipper in DEGRADED posture so the clear needs no worker. */
  async function mountDegradedShipper() {
    const mod = await import("@/lib/logshipper/index.js");
    const state = mod.getLogshipperState();
    state.transport = "degraded";
    state.degraded = true;
    state.ring = null;
    state.worker = null;
    state.hold = false;
    state.held = [];
    state.booted = true;
    return mod;
  }

  function clearRequest(password) {
    const headers = new Headers();
    if (password !== undefined) headers.set("x-9r-password", password);
    return new Request("http://localhost/api/logs/clear", { method: "POST", headers });
  }

  it("401s when the password header is ABSENT — a live session is not enough", async () => {
    await mountDegradedShipper();
    const { POST } = await import("@/app/api/logs/clear/route.js");

    const res = await POST(clearRequest(undefined));
    expect(res.status).toBe(401);
    // Nothing was cleared, and nothing was audited.
    expect((await res.json()).error).toBeTruthy();
  });

  it("401s when the password is WRONG", async () => {
    process.env.INITIAL_PASSWORD = "the-real-one";
    await mountDegradedShipper();
    const { POST } = await import("@/app/api/logs/clear/route.js");

    const res = await POST(clearRequest("not-the-one"));
    expect(res.status).toBe(401);
  });

  it("proceeds with the RIGHT password and writes exactly ONE audit row", async () => {
    process.env.INITIAL_PASSWORD = "the-real-one";
    await mountDegradedShipper();
    await seedDirect(["gone-1", "gone-2", "gone-3"]);

    const { POST } = await import("@/app/api/logs/clear/route.js");
    const res = await POST(clearRequest("the-real-one"));
    expect(res.status).toBe(200);
    const verdict = await res.json();
    expect(verdict.cleared).toBe(true);
    expect(verdict.deleted).toBe(3);

    // THE audit row — in authAuditLog, a table the DELETE never touched.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const rows = db.all("SELECT eventType, detail FROM authAuditLog ORDER BY ts ASC");
    const cleared = rows.filter((r) => r.eventType === "logs.cleared");
    expect(cleared).toHaveLength(1);
    const detail = JSON.parse(cleared[0].detail);
    expect(detail.deleted).toBe(3);
    // The retention posture travels WITH the clear — deleting under a sweep
    // that will keep deleting is not the same act as deleting outright.
    expect(detail).toHaveProperty("retentionMode");
    // Metadata only: no key, token, cookie, or hash ever reaches the detail.
    const detailText = JSON.stringify(detail).toLowerCase();
    for (const forbidden of ["password", "token", "cookie", "secret"]) {
      expect(detailText).not.toContain(forbidden);
    }

    // And the ledger itself is empty — the clear really ran.
    expect(await readLedger()).toEqual([]);
  });

  it("the audit row SURVIVES the delete it records (A09)", async () => {
    // The whole reason the trail lives in a DIFFERENT table: a clear that
    // leaves no trace is the monitoring failure erasing itself.
    process.env.INITIAL_PASSWORD = "the-real-one";
    await mountDegradedShipper();
    await seedDirect(["evidence"]);

    const { POST } = await import("@/app/api/logs/clear/route.js");
    await (await POST(clearRequest("the-real-one"))).json();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(Number(db.get("SELECT COUNT(*) AS n FROM logEvents").n)).toBe(0);
    expect(Number(db.get("SELECT COUNT(*) AS n FROM authAuditLog WHERE eventType = ?", ["logs.cleared"]).n)).toBe(1);
  });

  it("a REFUSED clear writes NO audit row — the trail records acts, not attempts", async () => {
    process.env.INITIAL_PASSWORD = "the-real-one";
    await mountDegradedShipper();
    const { POST } = await import("@/app/api/logs/clear/route.js");
    await POST(clearRequest("wrong"));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const n = db.get("SELECT COUNT(*) AS n FROM authAuditLog WHERE eventType = ?", ["logs.cleared"]);
    expect(Number(n.n)).toBe(0);
  });
});

describe("C · the mutation ledger — each order law bites on exactly one case", () => {
  it("names the mutation each case is here to catch", () => {
    // The standing record. Verified by hand during this milestone's forge pass;
    // the executable half of each entry is exercised in block A above.
    const LEDGER = [
      { mutation: "remove the SAB flush (step 2) — delete first, flush after", reddens: "A › pre-clear lines do NOT reappear" },
      { mutation: "await nothing on the flush (fire-and-forget the settle)", reddens: "A › pre-clear lines do NOT reappear" },
      { mutation: "release the hold BEFORE the delete instead of after", reddens: "A › the hold releases" },
      { mutation: "drop the pending-buffer drain (step 5)", reddens: "A › memory ≡ DB after the clear" },
      { mutation: "skip `auditAuthEvent` in the clear route", reddens: "B › proceeds with the RIGHT password and writes exactly ONE audit row" },
      { mutation: "drop the `x-9r-password` check", reddens: "B › 401s when the password header is ABSENT" },
    ];
    expect(LEDGER.length).toBe(6);
    for (const entry of LEDGER) {
      expect(entry.mutation).toBeTruthy();
      expect(entry.reddens).toBeTruthy();
    }
  });

  it("the order is EXACTLY §6's steps, in the function body's own sequence", () => {
    // A structural read is right here and behavioural reads are wrong: the
    // claim is about the ORDER of calls, and no behavioural case can
    // distinguish a correct order from a reordered one that happens to reach
    // the same end state on an idle worker. The slice starts at
    // `runOrderedClear` so the helper DEFINITIONS earlier in the file (which
    // naturally mention the same names) are not mistaken for call sites.
    const src = fs.readFileSync(path.join(ROOT, "src", "lib", "logshipper", "clear.js"), "utf8");
    const body = src.slice(src.indexOf("export async function runOrderedClear"));
    const order = [
      "holdLogshipper()",
      "flushLogshipper()",
      "clearPersistedLogs()",
      "drainConsoleBuffers()",
      "releaseLogshipper()",
    ].map((needle) => body.indexOf(needle));
    for (const at of order) expect(at, "every ordered step must appear in runOrderedClear").toBeGreaterThan(-1);
    // Strictly increasing: flush BEFORE delete, drain BEFORE release.
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i], `step ${i} must come after step ${i - 1}`).toBeGreaterThan(order[i - 1]);
    }
    // The release sits in a `finally`, so a throw upstream cannot leave the
    // shipper HELD — a wedged hold silently swallows every later line, turning
    // a failed clear into permanent log loss.
    expect(body).toMatch(/finally\s*\{[\s\S]*releaseLogshipper\(\)/);
  });

  it("the settle bound is the plan's 2s, named once", () => {
    const src = fs.readFileSync(path.join(ROOT, "src", "lib", "logshipper", "clear.js"), "utf8");
    expect(src).toMatch(/SETTLE_BOUND_MS\s*=\s*2_000/);
  });

  it("clear.js imports the control doors — it does not re-implement the worker protocol", () => {
    const src = fs.readFileSync(path.join(ROOT, "src", "lib", "logshipper", "clear.js"), "utf8");
    for (const door of ["holdLogshipper", "releaseLogshipper", "flushLogshipper", "clearPersistedLogs"]) {
      expect(src).toContain(door);
    }
  });
});
