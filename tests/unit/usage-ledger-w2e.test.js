// Usage Observatory W2-E — the Requests deck's engine contract.
//
// Covers, against a real sqlite twin:
//   • The client/server SORTABLE_COLUMNS mirror cannot drift (drift guard —
//     the UI mirror must stay identical to the engine's frozen map).
//   • `q` full-text search over the ledger census (provider/model/status/
//     keyName) — the deck's deck-local facet.
//   • Keyset pagination continuation on a non-timestamp sort column — the
//     cursor carries the sort column's OWN value, pages never overlap.
//   • NULLS LAST on nullable sort columns (latencyMs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w2e-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w2e-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function boot() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
  return { db, saveRequestUsage };
}

function req(routePath, qs = "") {
  return new Request(`http://localhost${routePath}${qs ? `?${qs}` : ""}`);
}

async function seedRows(saveRequestUsage, now) {
  const iso = (ms) => new Date(ms).toISOString();
  // 6 rows: varied provider/model/cost/latency; row 0 carries the @-prefixed
  // model the `q` test hunts; rows 4-5 have NO latency (NULLS LAST probe).
  const rows = [
    { provider: "openai", model: "@evil-gpt", status: "ok", latencyMs: 120, httpStatus: 200, tokens: { prompt_tokens: 100, completion_tokens: 50 }, cost: 0.006 },
    { provider: "anthropic", model: "claude-sonnet-4", status: "ok", latencyMs: 300, httpStatus: 200, tokens: { prompt_tokens: 200, completion_tokens: 80 }, cost: 0.004 },
    { provider: "openai", model: "gpt-4o", status: "ok", latencyMs: 220, httpStatus: 200, tokens: { prompt_tokens: 150, completion_tokens: 60 }, cost: 0.005 },
    { provider: "evilcorp", model: "mystery-model", status: "error", latencyMs: 500, httpStatus: 500, tokens: { prompt_tokens: 90, completion_tokens: 10 }, cost: 0.001 },
    { provider: "openai", model: "gpt-4o-mini", status: "ok", httpStatus: 200, tokens: { prompt_tokens: 80, completion_tokens: 40 }, cost: 0.002 },
    { provider: "anthropic", model: "claude-sonnet-4", status: "timeout", httpStatus: 504, tokens: { prompt_tokens: 70, completion_tokens: 0 }, cost: 0.003 },
  ];
  for (let i = 0; i < rows.length; i++) {
    await saveRequestUsage({ ...rows[i], timestamp: iso(now - i * 60_000) });
  }
}

describe("W2-E Requests deck — client/server sort mirror", () => {
  it("the client mirror never drifts from the engine's frozen map", async () => {
    const { SORTABLE_COLUMNS } = await import("@/lib/db/usageNames.js");
    const { LEDGER_SORTABLE_COLUMNS } = await import("@/lib/db/usageEnrich.js");
    expect([...LEDGER_SORTABLE_COLUMNS].sort()).toEqual(Object.keys(SORTABLE_COLUMNS).sort());
  });
});

describe("W2-E Requests deck — ledger search (q facet)", () => {
  it("q matches model content", async () => {
    const now = Date.now();
    await boot();
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    await seedRows(saveRequestUsage, now);
    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");
    const res = await GET(req("/api/usage/metrics/ledger", "period=24h&q=evil-gpt"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].model).toBe("@evil-gpt");
  });

  it("q matches provider content", async () => {
    const now = Date.now();
    await boot();
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    await seedRows(saveRequestUsage, now);
    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");
    const res = await GET(req("/api/usage/metrics/ledger", "period=24h&q=evilcorp"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].provider).toBe("evilcorp");
  });
});

describe("W2-E Requests deck — keyset pagination on a non-timestamp sort", () => {
  it("sort=cost pages deeper without overlap or gaps", async () => {
    const now = Date.now();
    await boot();
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    await seedRows(saveRequestUsage, now);
    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");

    const r1 = await GET(req("/api/usage/metrics/ledger", "period=24h&sort=cost&order=desc&limit=2"));
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.items.length).toBe(2);
    // Costs are pricing-derived at write time (golden-sum) — assert the ORDER
    // contract, not values: desc pages are non-increasing across the walk.
    expect(b1.items[0].cost).toBeGreaterThanOrEqual(b1.items[1].cost);
    expect(b1.nextCursor).toBeTruthy();

    const r2 = await GET(req("/api/usage/metrics/ledger", `period=24h&sort=cost&order=desc&limit=2&after=${encodeURIComponent(JSON.stringify(b1.nextCursor))}`));
    const b2 = await r2.json();
    expect(b2.items.map((r) => r.id)).not.toEqual(expect.arrayContaining(b1.items.map((r) => r.id)));
    if (b2.items.length > 0) {
      expect(b2.items[0].cost).toBeLessThanOrEqual(b1.items[b1.items.length - 1].cost);
    }

    const r3 = await GET(req("/api/usage/metrics/ledger", `period=24h&sort=cost&order=desc&limit=2&after=${encodeURIComponent(JSON.stringify(b2.nextCursor))}`));
    const b3 = await r3.json();
    expect(b3.items.length).toBe(2);
    // A FULL page always carries a cursor (the engine cannot know it's the
    // end without asking); the walk terminates on the first partial page.
    const r4 = await GET(req("/api/usage/metrics/ledger", `period=24h&sort=cost&order=desc&limit=2&after=${encodeURIComponent(JSON.stringify(b3.nextCursor))}`));
    const b4 = await r4.json();
    expect(b4.items.length).toBe(0);
    expect(b4.nextCursor).toBeNull();
    // The full walk covers all 6 seeded rows exactly once.
    const all = [...b1.items, ...b2.items, ...b3.items].map((r) => r.id);
    expect(new Set(all).size).toBe(6);
  });

  it("nullable sort columns (latencyMs) put NULLs last", async () => {
    const now = Date.now();
    await boot();
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    await seedRows(saveRequestUsage, now);
    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");
    const res = await GET(req("/api/usage/metrics/ledger", "period=24h&sort=latencyMs&order=desc&limit=10"));
    const body = await res.json();
    const latencies = body.items.map((r) => r.latencyMs);
    // desc: non-null descending first, then the two null rows at the tail.
    expect(latencies.slice(0, 4)).toEqual([500, 300, 220, 120]);
    expect(latencies.slice(4)).toEqual([null, null]);
  });
});
