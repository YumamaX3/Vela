// Usage Observatory W1-D — the SSE contract's proof.
// Sealed plan item 7 + phase13 R5: perProvider rides a ≤30s server memo;
// full-stats recompute coalesces ≥15s; quickStats carries the frame.
// Part 1: the repo-layer memo (real sqlite). Part 2: the route (mocked seam).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Part 1 — the repo memo ────────────────────────────────────────────────

describe("W1-D getPerProviderFrame — the ≤30s server memo", () => {
  let tempDir;
  let liveAdapter = null; // captured before any poisoning so Windows releases the file
  const saved = {};

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w1d-"));
    liveAdapter = null;
    for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
    process.env.DATA_DIR = tempDir;
    process.env.API_KEY_SECRET = "w1d-secret";
    delete process.env.VELA_MYSQL_URL;
    delete global._dbAdapter;
    delete global.__velaPerProviderMemo; // fresh memo per leg
    vi.resetModules();
  });

  afterEach(() => {
    try { (liveAdapter || global._dbAdapter?.instance)?.close?.(); } catch {}
    delete global._dbAdapter;
    delete global.__velaPerProviderMemo;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("serves the same frame within the TTL (no re-scan)", async () => {
    const { saveRequestUsage, getPerProviderFrame } = await import("@/lib/db/repos/usageRepo.js");
    await saveRequestUsage({ timestamp: new Date().toISOString(), provider: "openai", model: "m", status: "ok", tokens: { prompt_tokens: 1 } });

    const first = await getPerProviderFrame();
    const second = await getPerProviderFrame();
    expect(second).toBe(first); // same object — the memo, not a re-scan
    expect(first.perProvider.openai.requests).toBe(1);
  });

  it("re-scans after the TTL expires", async () => {
    const { saveRequestUsage, getPerProviderFrame } = await import("@/lib/db/repos/usageRepo.js");
    await saveRequestUsage({ timestamp: new Date().toISOString(), provider: "openai", model: "m", status: "ok", tokens: { prompt_tokens: 1 } });

    const first = await getPerProviderFrame();
    // Age the memo past the 30s TTL by hand (no real-time wait).
    global.__velaPerProviderMemo.ts -= 31_000;
    await saveRequestUsage({ timestamp: new Date().toISOString(), provider: "anthropic", model: "m2", status: "ok", tokens: { prompt_tokens: 1 } });
    const second = await getPerProviderFrame();
    expect(second).not.toBe(first);
    expect(second.perProvider.anthropic.requests).toBe(1); // fresh scan saw the new row
  });

  it("fails open — a dead adapter serves the stale frame, never throws", async () => {
    const { saveRequestUsage, getPerProviderFrame } = await import("@/lib/db/repos/usageRepo.js");
    await saveRequestUsage({ timestamp: new Date().toISOString(), provider: "openai", model: "m", status: "ok", tokens: { prompt_tokens: 1 } });
    const warm = await getPerProviderFrame();
    liveAdapter = global._dbAdapter.instance; // capture BEFORE poisoning (teardown closes it)

    // Kill the adapter in place (mutate the SAME object driver.js captured,
    // so its closure sees the poisoned promise), then force the memo past
    // its TTL so the next call attempts a real scan.
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = Promise.reject(new Error("dead twin"));
    global._dbAdapter.initPromise.catch(() => {}); // keep node from flagging it
    global.__velaPerProviderMemo.ts -= 31_000;

    const stale = await getPerProviderFrame(); // must NOT throw
    expect(stale).toBe(warm); // the last good frame, honestly stale
  });

  it("fails open — no warm frame yields an empty window, never throws", async () => {
    const { getPerProviderFrame } = await import("@/lib/db/repos/usageRepo.js");
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = Promise.reject(new Error("dead twin"));
    global._dbAdapter.initPromise.catch(() => {});
    const frame = await getPerProviderFrame();
    expect(frame.perProvider).toEqual({});
  });
});

// ─── Part 2 — the route contract (mocked seam) ─────────────────────────────

const h = vi.hoisted(() => {
  const { EventEmitter } = require("node:events");
  return {
    emitter: new EventEmitter(),
    calls: { full: 0, active: 0, frame: 0 },
  };
});

vi.mock("@/lib/usageDb", () => ({
  statsEmitter: h.emitter,
  getUsageStats: async () => { h.calls.full++; return { totalRequests: 7, marker: "FULL" }; },
  getActiveRequests: async () => { h.calls.active++; return { activeRequests: [], recentRequests: [], errorProvider: null }; },
  getPerProviderFrame: async () => { h.calls.frame++; return { perProvider: { openai: { requests: 2, errors: 0 } }, windowMs: 60000, ts: 123 }; },
}));

describe("W1-D SSE route — coalesced recompute + perProvider carriage", () => {
  let GET;

  beforeEach(async () => {
    h.calls.full = 0; h.calls.active = 0; h.calls.frame = 0;
    h.emitter.removeAllListeners();
    vi.useFakeTimers();
    vi.resetModules();
    ({ GET } = await import("@/app/api/usage/stream/route.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function readEvents(reader, dec, n) {
    const events = [];
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = dec.decode(value);
      for (const m of text.matchAll(/^data: (.+)$/gm)) events.push(JSON.parse(m[1]));
    }
    return events;
  }

  it("first paint carries full stats + perProvider; update storm coalesces to ONE recompute", async () => {
    const res = await GET();
    const reader = res.body.getReader();
    const dec = new TextDecoder();

    const first = await readEvents(reader, dec, 1);
    expect(first[0].marker).toBe("FULL");
    expect(first[0].perProvider.perProvider.openai.requests).toBe(2);
    expect(h.calls.full).toBe(1);

    // An update storm — five events inside the 15s window must NOT trigger a
    // single additional heavy recompute; they ride the lightweight path.
    for (let i = 0; i < 5; i++) h.emitter.emit("update");
    const quick = await readEvents(reader, dec, 5);
    expect(quick.length).toBe(5);
    expect(quick.every((e) => e.marker === "FULL" && e.perProvider)).toBe(true); // cached stats + live frame
    expect(h.calls.full).toBe(1); // THE coalescing law

    await reader.cancel();
  });

  it("after the 15s window, the next update settles a fresh full recompute", async () => {
    const res = await GET();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    await readEvents(reader, dec, 1); // first paint
    expect(h.calls.full).toBe(1);

    await vi.advanceTimersByTimeAsync(16_000); // past the coalesce window
    h.emitter.emit("update");
    const after = await readEvents(reader, dec, 2); // quick push + new full
    expect(after.some((e) => e.marker === "FULL")).toBe(true);
    expect(h.calls.full).toBe(2); // exactly one more heavy recompute

    await reader.cancel();
  });

  it("pending events never trigger a full recompute — lightweight only", async () => {
    const res = await GET();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    await readEvents(reader, dec, 1);
    expect(h.calls.full).toBe(1);

    for (let i = 0; i < 3; i++) h.emitter.emit("pending");
    const quick = await readEvents(reader, dec, 3);
    expect(quick.length).toBe(3);
    expect(h.calls.full).toBe(1); // pending never recomputes
    expect(h.calls.frame).toBeGreaterThanOrEqual(3); // each quick push consumed the memo

    await reader.cancel();
  });
});
