// P5 pin — the dashboard coalescing mend (plans/2026-11-01-responsive-tide-
// performance.md §III, suspects 1 + 7; "pin (f)" = this file).
//
// THE CORRECTNESS LAW: the memo and every SQL move must never change an
// answer. Part 1 proves the SQL move against a frozen copy of the PRE-MEND JS
// walk (tests/unit/fixtures/usage-stats-p5-frozen.js, byte-verbatim from
// 0e2ba927) on ONE seeded bank. Part 2 proves the memo passes the period
// through untouched and never serves one period's answer for another.
// Part 3 proves the routes carry the client's period, and the stream's 15s
// coalescing still holds when it rides the shared seam.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";

const saved = {};
let tempDir;

// ONE adapter for the whole file: better-sqlite3's stmtCache dies with its
// connection, so a per-test mkdtemp+close cycle leaves every test after the
// first holding a closed adapter (the "connection is not open" wave). The
// bank is initialized once in beforeAll; beforeEach wipes the rows and the
// memo; afterAll closes. Part 3's module mocks ride vi.doMock/unmock inside
// their own describe and re-import per test — the global env stays intact.
beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-p5-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "p5-secret";
  delete process.env.VELA_MYSQL_URL;
  vi.unmock("@/lib/usageDb");
});

afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global.__velaUsageStatsMemo;
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  delete global.__velaUsageStatsMemo;
  vi.unmock("@/lib/db/index.js");
  vi.resetModules();
  // Wipe the ledger between tests so each starts from the empty bank
  // seedBank() expects — without tearing down the adapter.
  const { initDb } = await import("@/lib/db/index.js");
  await initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  db.run("DELETE FROM usageHistory");
  db.run("DELETE FROM usageDaily");
  db.run("DELETE FROM requestDetails");
});

// ─── Part 3 — the transports carry the client's period ─────────────────────

const h = vi.hoisted(() => {
  const { EventEmitter } = require("node:events");
  return { emitter: new EventEmitter(), calls: { full: 0, active: 0, frame: 0, shared: [], coalesced: [] } };
});

vi.mock("@/lib/usageDb", () => ({
  statsEmitter: h.emitter,
  getUsageStats: async (p) => { h.calls.full++; return { totalRequests: 7, marker: "FULL", echoed: p ?? "all" }; },
  getActiveRequests: async () => { h.calls.active++; return { activeRequests: [], recentRequests: [], errorProvider: null, pending: { byModel: {} } }; },
  getPerProviderFrame: async () => { h.calls.frame++; return { perProvider: { openai: { requests: 2, errors: 0 } }, windowMs: 60000, ts: 123 }; },
}));

vi.mock("@/lib/db/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    usageStatsShared: async (p) => {
      h.calls.shared.push(p);
      const s = await (await import("@/lib/usageDb")).getUsageStats(p);
      return { ...s, pending: {}, activeRequests: [], recentRequests: [], errorProvider: "" };
    },
    usageStatsCoalesced: async (p) => {
      h.calls.coalesced.push(p);
      h.calls.shared.push(p);
      const s = await (await import("@/lib/usageDb")).getUsageStats(p);
      return { ...s, pending: {}, activeRequests: [], recentRequests: [], errorProvider: "" };
    },
  };
});

describe("P5 part 3 — the period rides the wire", () => {
  beforeEach(() => {
    h.calls.full = 0; h.calls.active = 0; h.calls.frame = 0; h.calls.shared = []; h.calls.coalesced = [];
    h.emitter.removeAllListeners();
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => vi.useRealTimers());

  async function readEvents(reader, dec, n) {
    const events = [];
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const m of dec.decode(value).matchAll(/^data: (.+)$/gm)) events.push(JSON.parse(m[1]));
    }
    return events;
  }

  it("stream: ?period=7d reaches getUsageStats; absent falls open to 7d, junk too", async () => {
    const { GET } = await import("@/app/api/usage/stream/route.js");
    for (const [url, expected] of [
      ["http://x/api/usage/stream?period=24h", "24h"],
      ["http://x/api/usage/stream", "7d"],
      ["http://x/api/usage/stream?period=bogus", "7d"],
    ]) {
      const reader = (await GET({ url })).body.getReader();
      const [first] = await readEvents(reader, new TextDecoder(), 1);
      expect(first.echoed).toBe(expected);
      await reader.cancel();
    }
  });

  it("stream: still coalesces per client to ONE recompute per 15s storm", async () => {
    const { GET } = await import("@/app/api/usage/stream/route.js");
    const reader = (await GET({ url: "http://x/api/usage/stream?period=today" })).body.getReader();
    await readEvents(reader, new TextDecoder(), 1);
    expect(h.calls.coalesced).toEqual(["today"]);
    for (let i = 0; i < 5; i++) h.emitter.emit("update");
    await readEvents(reader, new TextDecoder(), 5);
    expect(h.calls.coalesced).toEqual(["today"]); // no extra heavy read inside the window
    await reader.cancel();
  });

  it("stats REST: the period reaches the shared memo; junk is still a 400; absent is 7d", async () => {
    const { GET } = await import("@/app/api/usage/stats/route.js");
    const ok = await GET(new Request("http://x/api/usage/stats?period=30d"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).echoed).toBe("30d");
    expect(h.calls.shared).toEqual(["30d"]);
    const bad = await GET(new Request("http://x/api/usage/stats?period=bogus"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid period" });
    const none = await GET(new Request("http://x/api/usage/stats"));
    expect((await none.json()).echoed).toBe("7d");
  });
});
