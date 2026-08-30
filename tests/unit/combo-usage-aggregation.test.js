// Test covenant: combo-usage-aggregation — getComboUsage answers "which combo
// burns my tokens?" against a real temp DB (migration 015 lands the column on
// boot). Totals per combo, ok-count, first/last activity, and the fixed-width
// bucketed series the combos-page sparkline draws. Direct (combo NULL) rows
// never leak into the aggregation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-combo-agg-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "combo-agg-test-secret";
  delete global._dbAdapter;
  // driver.js captures `state = global._dbAdapter` at module load — resetting
  // the registry makes the next import re-bind state to the fresh global
  // object (the apikey-internal-key.test.js recipe).
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

function insertUsage(db, { combo, prompt = 10, completion = 5, statusClass = "ok", cost = 0.001, agoMs = 0 }) {
  const ts = new Date(Date.now() - agoMs).toISOString();
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens, cost, status, statusClass, combo) VALUES(?, 'openai', 'gpt-5', '', '', ?, ?, ?, 'ok', ?, ?)`,
    [ts, prompt, completion, cost, statusClass, combo]
  );
}

describe("getComboUsage — per-combo attribution aggregation", () => {
  it("aggregates only combo rows: totals, ok count, fixed-width series", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { getComboUsage } = await import("@/lib/db/repos/sqlite/usageRepo.js");

    // Two combo rows (one ok, one rate_limited) + one direct row (combo NULL).
    insertUsage(db, { combo: "vela/cc/opus", prompt: 100, completion: 50, statusClass: "ok" });
    insertUsage(db, { combo: "vela/cc/opus", prompt: 10, completion: 5, statusClass: "rate_limited" });
    insertUsage(db, { combo: null, prompt: 999, completion: 999 });

    const res = await getComboUsage({ hours: 24, buckets: 12 });

    expect(res.hours).toBe(24);
    expect(res.buckets).toBe(12);
    expect(res.combos).toHaveLength(1); // the direct row never appears

    const agg = res.combos[0];
    expect(agg.combo).toBe("vela/cc/opus");
    expect(agg.requests).toBe(2);
    expect(agg.promptTokens).toBe(110);
    expect(agg.completionTokens).toBe(55);
    expect(agg.ok).toBe(1);
    expect(agg.firstAt).toBeTruthy();
    expect(agg.lastAt).toBeTruthy();

    expect(agg.series).toHaveLength(12);
    const seriesRequests = agg.series.reduce((n, s) => n + s.requests, 0);
    const seriesTokens = agg.series.reduce((n, s) => n + s.tokens, 0);
    const seriesOk = agg.series.reduce((n, s) => n + s.ok, 0);
    expect(seriesRequests).toBe(2);
    expect(seriesTokens).toBe(165);
    expect(seriesOk).toBe(1);
    // both rows are "now" → they land in the final bucket
    expect(agg.series[11].requests).toBe(2);
  });

  it("separates combos and honors the time window", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { getComboUsage } = await import("@/lib/db/repos/sqlite/usageRepo.js");

    // Distinct token values per row — the uq_uh_dedupe UNIQUE identity
    // includes promptTokens/completionTokens, and same-millisecond inserts
    // with identical values would collide (a timing flake, not a feature).
    insertUsage(db, { combo: "vela/cc/opus", prompt: 10, completion: 5 });
    insertUsage(db, { combo: "vela/deepseek/v4-flash", prompt: 20, completion: 8 });
    // Outside the 24h window — must not count.
    insertUsage(db, { combo: "vela/cc/opus", prompt: 30, completion: 12, agoMs: 25 * 3600000 });

    const res = await getComboUsage({ hours: 24, buckets: 24 });
    const byName = Object.fromEntries(res.combos.map((c) => [c.combo, c]));

    expect(Object.keys(byName)).toHaveLength(2);
    expect(byName["vela/cc/opus"].requests).toBe(1);
    expect(byName["vela/deepseek/v4-flash"].requests).toBe(1);
  });

  it("empty ledger returns an empty combo list with window metadata", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();
    const { getComboUsage } = await import("@/lib/db/repos/sqlite/usageRepo.js");

    const res = await getComboUsage({ hours: 24, buckets: 24 });
    expect(res.combos).toEqual([]);
    expect(res.since).toBeTruthy();
  });
});

describe("GET /api/combos/usage — clamps and shape", () => {
  it("clamps oversized hours/buckets and returns the aggregation shape", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    insertUsage(db, { combo: "vela/cc/opus" });

    const { GET } = await import("@/app/api/combos/usage/route.js");
    const req = new Request("http://localhost/api/combos/usage?hours=9999&buckets=9999");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.hours).toBe(72); // clamped from 9999
    expect(body.buckets).toBe(72); // clamped from 9999
    expect(body.combos).toHaveLength(1);
    expect(body.combos[0].series).toHaveLength(72);
  });

  it("defaults hours=24 buckets=24 when params are absent", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    insertUsage(db, { combo: "vela/cc/opus" });

    const { GET } = await import("@/app/api/combos/usage/route.js");
    const res = await GET(new Request("http://localhost/api/combos/usage"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.hours).toBe(24);
    expect(body.buckets).toBe(24);
    expect(body.combos[0].combo).toBe("vela/cc/opus");
  });
});
