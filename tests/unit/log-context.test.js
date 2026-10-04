// M6 — The Voyage Key (sealed plan r3 §3, milestone M6's proof).
//
// WHAT THIS SUITE IS FOR. Correlation is the one promise the log pipeline makes
// that is easy to fake and impossible to see: a wrong reqId does not crash, does
// not throw, and renders as a perfectly plausible row joined to the perfectly
// plausible voyage it does not belong to. So each case here pins a claim that
// has a FALSE answer which still "works":
//
//   1. The stamp reaches nested console.* with ZERO call-site edits. The mock is
//      not optional — inside vitest, console.* is intercepted by the runner and
//      never reaches process.stdout.write, so the assertions below would pass
//      against a wrapper that captured nothing at all. We install a fake
//      original FIRST (the production chain, rebuilt, exactly as
//      log-double-capture.test.js does) and read the RING, which only the real
//      wrapper fills. A dropped stamp is invisible without this.
//   2. A store that outlived its request yields null, never a stale reqId
//      (the wallkeeper's forged-attribution finding, sealed as the closedAt
//      liveness law). Detached async work inherits the ALS store; without the
//      liveness check it would attribute its line to a finished request.
//   3. An inbound x-vela-request-id is NEVER adopted. It is client-controlled,
//      so adopting it would let a caller name a voyage and poison the ledger.
//
// A NOTE ON THE ID SHAPE, read before "fixing" a regex below: the random half
// of a reqId is base64url with `-_` stripped, so it legitimately carries
// UPPERCASE. A lowercase-only pattern would redden on roughly half of all ids
// — a flaky assertion that teaches nothing. Every pattern in this file asserts
// the SHAPE (`req-` + base36 time + random) and says nothing about case.
//   4. upstreamId is PER-CALL: two stamps, last wins, and the request-wide
//      reqId is untouched by either.
//   5. The usage ledger row carries the same reqId (real adapter, real
//      migration chain, temp DATA_DIR) — the ledger↔log join.
//   6. The response echoes OUR id, never the inbound one.
//
// The two mutations the plan names are exercised at the bottom of this file's
// report to Main: mint-from-header reddens (3); removing the liveness check
// reddens (2).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

import {
  withVoyage,
  getVoyage,
  stampUpstreamCall,
  mintVoyageReqId,
  voyageStorage,
  VOYAGE_HEADER,
} from "@/lib/logContext.js";

// ── The production console chain, rebuilt (log-double-capture's pattern) ────
// Replace console.log BEFORE initConsoleLogCapture so the wrapper holds THIS as
// its original; it writes to process.stdout exactly as node's real console does,
// so the tap's suppression window is genuinely exercised.
console.log = (...args) => {
  process.stdout.write(`VIA-ORIGINAL ${args.map(String).join(" ")}\n`);
};
const { initConsoleLogCapture, clearConsoleLogs, getConsoleLogs, getRawLogs } = await import(
  "@/lib/consoleLogBuffer.js"
);
initConsoleLogCapture();

const settle = () => new Promise((r) => setTimeout(r, 120));

/** The structured entries the real wrapper produced for a probe line. */
function ringEntriesFor(probe) {
  return getConsoleLogs({ structured: true }).filter((e) => e.message.includes(probe));
}

// ── The DB harness, and the trap it is built around ───────────────────────
// THE LAW, restated because this file breaks it deliberately: paths.js freezes
// DATA_DIR at first import and driver.js binds global._dbAdapter at module
// eval, so a per-test temp DATA_DIR normally costs a `vi.resetModules()` in
// BOTH hooks.
//
// That reset is ALSO what breaks correlation under test. It hands the DB layer
// a SECOND copy of logContext.js, and a second AsyncLocalStorage: the writer
// would then stamp a store that no console wrapper can ever read, and the
// ledger join would redden for a reason that has nothing to do with the code
// under test. `voyageStorage` is a const binding, so it cannot be re-bound from
// outside — the honest fix is to not reset.
//
// So the two DB cases share ONE temp DATA_DIR, set BEFORE the db layer's first
// import, and neither hook resets the registry. The suites stay isolated (a
// unique temp dir per FILE, closed and removed in the hook) while the ALS
// stays the singleton it is in production. Isolation between db-state cases is
// carried by connectionId — each row is looked up by its own name, so one case
// cannot read another's row.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-voyage-"));
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
process.env.DATA_DIR = tempDir;
process.env.API_KEY_SECRET = "voyage-test-secret";

const { saveRequestUsage } = await import("@/lib/db/repos/sqlite/usageRepo.js");
const { getAdapter } = await import("@/lib/db/driver.js");

async function bootNative() {
  delete global._dbAdapter;
  return getAdapter();
}

/** The stamped row, looked up by the connectionId the case itself wrote. */
function usageRow(db, connectionId) {
  return db.get(
    `SELECT reqId, upstreamId FROM usageHistory WHERE connectionId = ?`,
    [connectionId]
  );
}

beforeEach(() => {
  clearConsoleLogs();
});

// Teardown happens ONCE, at the end of the file, not per case: the temp dir
// was created once and the module registry was never reset, so closing the
// handle and removing the dir per test would strand the second case. Windows
// EPERM is the documented symptom of an open handle (the DB-harness trap), so
// the close runs before the remove and the remove is guarded either way.
afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

describe("the voyage key — reqId reaches the console with zero call-site edits (§3)", () => {
  it("a console call inside a voyage carries that voyage's reqId", async () => {
    const seen = [];
    await withVoyage(async function handler() {
      console.log("nested probe alpha");
      seen.push(getVoyage()?.reqId);
      return new Response("ok");
    })(new Request("http://localhost/v1/chat/completions"));

    await settle();
    const entries = ringEntriesFor("nested probe alpha");
    expect(entries.length).toBe(1);
    expect(entries[0].reqId).toBe(seen[0]);
    expect(entries[0].reqId).toMatch(/^req-[a-z0-9]+-[A-Za-z0-9]+$/);
  });

  it("the line still reaches the terminal AND the raw tap stays empty (M1's law holds)", async () => {
    await withVoyage(async function handler() {
      console.log("nested probe bravo");
      return new Response("ok");
    })(new Request("http://localhost/v1/chat/completions"));

    await settle();
    expect(ringEntriesFor("nested probe bravo").length).toBe(1);
    expect(getRawLogs().some((e) => e.message.includes("nested probe bravo"))).toBe(false);
  });

  it("a console call OUTSIDE any voyage carries no reqId — never a forged one", async () => {
    console.log("unvoyaged probe charlie");
    await settle();
    const entries = ringEntriesFor("unvoyaged probe charlie");
    expect(entries.length).toBe(1);
    expect(entries[0].reqId ?? null).toBeNull();
  });
});

describe("the stale-context law — closedAt kills forged attribution (§3)", () => {
  it("a detached task that outlives its request reads null, not the finished reqId", async () => {
    let leaked = "unset";
    let detached;
    await withVoyage(async function handler() {
      // Fire-and-forget: this promise is NOT awaited by the handler, and ALS
      // propagates the store into it. This is precisely the shape the sealed
      // law exists for.
      detached = new Promise((resolve) => {
        setTimeout(() => {
          leaked = getVoyage()?.reqId ?? null;
          resolve();
        }, 5);
      });
      return new Response("ok");
    })(new Request("http://localhost/v1/chat/completions"));

    await detached;
    expect(leaked).toBeNull();
  });

  it("a line logged after the handler returned is not attributed to that request", async () => {
    let handle;
    await withVoyage(async function handler() {
      handle = { url: "http://localhost/v1/chat/completions" };
      return new Response("ok");
    })(new Request("http://localhost/v1/v1/chat/completions"));

    console.log("post-return probe delta");
    await settle();
    const entries = ringEntriesFor("post-return probe delta");
    expect(entries.length).toBe(1);
    expect(entries[0].reqId ?? null).toBeNull();
    expect(handle).toBeTruthy();
  });
});

describe("the scrub law — an inbound voyage header is never adopted (§3)", () => {
  it("mints fresh and ignores x-vela-request-id from the request", async () => {
    const forged = "req-forged-by-the-client";
    const response = await withVoyage(async function handler() {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    })(new Request("http://localhost/v1/chat/completions", {
      headers: { [VOYAGE_HEADER]: forged },
    }));

    const echoed = response.headers.get(VOYAGE_HEADER);
    expect(echoed).toBeTruthy();
    expect(echoed).not.toBe(forged);
    expect(echoed).toMatch(/^req-[a-z0-9]+-[A-Za-z0-9]+$/);
  });

  it("every request mints its OWN id — two voyages never share one", async () => {
    const first = await withVoyage(async () => new Response("a"))(new Request("http://x/1"));
    const second = await withVoyage(async () => new Response("b"))(new Request("http://x/2"));
    expect(first.headers.get(VOYAGE_HEADER)).not.toBe(second.headers.get(VOYAGE_HEADER));
  });

  it("mintVoyageReqId never returns a caller-supplied string", () => {
    const forged = "req-attacker";
    expect(mintVoyageReqId()).not.toBe(forged);
    expect(mintVoyageReqId()).toMatch(/^req-/);
  });
});

describe("upstreamId — per-call precedence (§3)", () => {
  it("two stamps in one voyage: the last call's id wins, the reqId does not move", async () => {
    let store;
    await withVoyage(async function handler() {
      stampUpstreamCall({ provider: "openai", upstreamId: "up-1" });
      stampUpstreamCall({ provider: "anthropic", upstreamId: "up-2" });
      store = { reqId: getVoyage()?.reqId, upstreamId: getVoyage()?.upstreamId, provider: getVoyage()?.provider };
      return new Response("ok");
    })(new Request("http://localhost/v1/chat/completions"));

    expect(store.upstreamId).toBe("up-2");
    expect(store.provider).toBe("anthropic");
    expect(store.reqId).toMatch(/^req-/);
  });

  it("a stamp with no upstreamId leaves the previous call's id intact", async () => {
    let store;
    await withVoyage(async function handler() {
      stampUpstreamCall({ provider: "openai", upstreamId: "up-keep" });
      stampUpstreamCall({ provider: "openai" }); // header absent on this hop
      store = { upstreamId: getVoyage()?.upstreamId };
      return new Response("ok");
    })(new Request("http://localhost/v1/chat/completions"));

    expect(store.upstreamId).toBe("up-keep");
  });

  it("stamping outside a voyage is a safe no-op", () => {
    expect(() => stampUpstreamCall({ provider: "openai", upstreamId: "x" })).not.toThrow();
    expect(getVoyage()).toBeNull();
  });
});

describe("the ledger join — usageHistory carries the voyage (§3)", () => {
  it("a row written inside a voyage reads back with that reqId, through the real adapter", async () => {
    const db = await bootNative();

    let reqId;
    await withVoyage(async function handler() {
      stampUpstreamCall({ provider: "openai", upstreamId: "up-ledger" });
      reqId = getVoyage()?.reqId;
      await saveRequestUsage({
        timestamp: "2026-10-04T00:00:00.000Z",
        provider: "openai",
        model: "gpt-5",
        connectionId: "conn-voyage",
        endpoint: "https://api.openai.com/v1/chat/completions",
        tokens: { prompt_tokens: 11, completion_tokens: 7 },
        cost: 0,
        status: "ok",
      });
      return new Response("ok");
    })(new Request("http://localhost/v1/chat/completions"));

    const row = usageRow(db, "conn-voyage");
    expect(row).toBeTruthy();
    expect(row.reqId).toBe(reqId);
    expect(row.upstreamId).toBe("up-ledger");
  });

  it("a row written OUTSIDE a voyage leaves both columns NULL — honest, not empty-string", async () => {
    const db = await bootNative();

    await saveRequestUsage({
      timestamp: "2026-10-04T00:00:01.000Z",
      provider: "openai",
      model: "gpt-5",
      connectionId: "conn-novoyage",
      endpoint: "https://api.openai.com/v1/chat/completions",
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
      cost: 0,
      status: "ok",
    });

    const row = usageRow(db, "conn-novoyage");
    expect(row).toBeTruthy();
    expect(row.reqId).toBeNull();
    expect(row.upstreamId).toBeNull();
  });
});

describe("the ALS store itself", () => {
  it("nested voyages restore the outer store rather than leaking the inner one", async () => {
    let outer;
    let inner;
    await withVoyage(async function outerHandler() {
      outer = getVoyage()?.reqId;
      await withVoyage(async function innerHandler() {
        inner = getVoyage()?.reqId;
      })();
      // The inner voyage has closed; the outer one is live again here.
      expect(getVoyage()?.reqId).toBe(outer);
      return new Response("ok");
    })(new Request("http://localhost/outer"));

    expect(inner).not.toBe(outer);
    expect(inner).toMatch(/^req-/);
    expect(outer).toMatch(/^req-/);
  });

  it("getVoyage() outside any run() is null", () => {
    expect(voyageStorage.getStore()).toBeUndefined();
    expect(getVoyage()).toBeNull();
  });
});