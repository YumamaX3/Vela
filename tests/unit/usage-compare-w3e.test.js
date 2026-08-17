// Usage Observatory W3-E — the compare-periods ghost's proof.
// Sealed plan W3-E: "compare-periods lands (CASE WHEN double-range + ghost
// overlay + Δ columns)". The CASE WHEN double-range + Δ columns were forged
// in W1-C (kpisImpl) and proven in usage-aggregation-w1c.test.js; THIS file
// proves the net-new ghost — filteredSeriesImpl(previous:true):
//   1. opt-out leaves the response shape untouched (no `previous` key)
//   2. a whole-bucket window aligns bucket-for-bucket (exact tier, UTC-floor)
//   3. the ghost respects filters (no provider bleed across the window)
//   4. a misaligned window ("today" at 1d) degrades to honest null gaps
//   5. "all" has no previous window → previous:[] + null prev-bounds
//   6. the default 7d period rides the usageDaily rollup tier — ghost too
//   7. parsePrevious shape-shapes only "1"/"true"
// Regression judged via the baseline, never raw green — this file is additive.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w3e-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w3e-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  delete global._usageEnrichmentCache;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._usageEnrichmentCache;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function boot() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter(); // boots schema + migrations
  const usageRepo = await import("@/lib/db/repos/sqlite/usageRepo.js");
  return { db, usageRepo };
}

/** Seed rows through the LIVE writer — telemetry columns + the usageDaily
 *  rollup ride the real write path (the ghost reads what W1-B writes). */
async function seed(usageRepo, rows) {
  for (const r of rows) await usageRepo.saveRequestUsage(r);
}

const T = "2026-08-16T10:00:00.000Z";
const NOW = new Date(T).getTime();
const CALL_NOW = NOW + 3_600_000; // 2026-08-16T11:00Z — every window's end edge
const DAY = 86_400_000;
const row = (timestamp, provider = "openai") => ({
  timestamp, provider, model: "gpt-4o", endpoint: "/v1/chat", status: "ok",
  tokens: { prompt_tokens: 10, completion_tokens: 5 }, latencyMs: 100, httpStatus: 200,
});
const sum = (points) => points.reduce((a, p) => a + p.value, 0);
const dayUTC = (iso) => Math.floor(new Date(iso).getTime() / DAY) * DAY;

// ─── 1. The opt-out — shape stays untouched ─────────────────────────────────

describe("W3-E ghost — opt-out and alignment", () => {
  it("previous absent/false leaves the response with no `previous` key", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [row(T)]);
    for (const opts of [{}, { previous: false }]) {
      const res = await usageRepo.getFilteredSeries({ period: "3d", granularity: "1d", metric: "requests", now: CALL_NOW, ...opts });
      expect("previous" in res).toBe(false);
      expect(res.points.length).toBeGreaterThan(0);
      expect(res.meta.prevStartMs).toBeUndefined();
    }
  });

  it("previous:true over a whole-bucket window aligns bucket-for-bucket (exact tier)", async () => {
    const { usageRepo } = await boot();
    // 3d window [Aug13T11:00Z, Aug16T11:00Z); previous [Aug10T11:00Z, Aug13T11:00Z).
    // Exact-tier buckets are UTC-day floors, and the 3d shift is a whole
    // multiple of the 1d bucket → every current bucket finds its prev twin.
    await seed(usageRepo, [
      row("2026-08-11T09:00:00.000Z"), // prev → bucket Aug11, pairs with cur Aug14
      row("2026-08-12T09:00:00.000Z"), // prev → bucket Aug12, pairs with cur Aug15
      row("2026-08-14T09:00:00.000Z"), // cur → bucket Aug14
      row("2026-08-15T09:00:00.000Z"), // cur → bucket Aug15
    ]);
    const res = await usageRepo.getFilteredSeries({ period: "3d", granularity: "1d", metric: "requests", previous: true, now: CALL_NOW });

    // meta carries the previous window's bounds — the same window kpisImpl's
    // CASE WHEN double-range uses ([startMs−len, startMs)).
    const len = res.meta.endMs - res.meta.startMs;
    expect(res.meta.prevStartMs).toBe(res.meta.startMs - len);
    expect(res.meta.prevEndMs).toBe(res.meta.startMs);

    // Same axis: same length, same bucket t, current values untouched.
    expect(res.previous.length).toBe(res.points.length);
    expect(res.previous.map((p) => p.t)).toEqual(res.points.map((p) => p.t));
    expect(sum(res.points)).toBe(2);

    // Whole-bucket alignment → no gaps; each prev twin carries its own day's 1.
    const byT = new Map(res.previous.map((p) => [p.t, p.value]));
    expect(byT.get(dayUTC("2026-08-14T00:00:00.000Z"))).toBe(1);
    expect(byT.get(dayUTC("2026-08-15T00:00:00.000Z"))).toBe(1);
    expect(res.previous.every((p) => p.value !== null)).toBe(true);
  });

  it("the ghost honors filters — no provider bleed across the window", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [
      row("2026-08-11T09:00:00.000Z", "anthropic"), // prev window, other provider
      row("2026-08-14T09:00:00.000Z"),              // cur window, filtered provider
    ]);
    const res = await usageRepo.getFilteredSeries({
      filters: { provider: "openai" }, period: "3d", granularity: "1d",
      metric: "requests", previous: true, now: CALL_NOW,
    });
    expect(sum(res.points)).toBe(1);
    // The anthropic row sits in the previous window — the filter must keep
    // it out of the ghost as surely as out of the curve.
    expect(sum(res.previous.filter((p) => p.value !== null))).toBe(0);
  });
});

// ─── 2. Honest degradation — never a shifted lie ────────────────────────────

describe("W3-E ghost — honest gaps", () => {
  it("a misaligned window (today at 1d) degrades to null gaps, never shifted values", async () => {
    const { usageRepo } = await boot();
    // "today" runs local midnight → now. On this host (UTC+7) local midnight
    // is 2026-08-15T17:00Z, so windowLen = 18h — NOT a whole multiple of the
    // 1d bucket, so no bucket lookup can align. Every gap stays honest-null.
    await seed(usageRepo, [
      row("2026-08-15T05:00:00.000Z"), // prev window (Aug14T23:00Z..Aug15T17:00Z)
      row("2026-08-15T23:00:00.000Z"), // cur window (Aug15T17:00Z..Aug16T11:00Z)
    ]);
    const res = await usageRepo.getFilteredSeries({ period: "today", granularity: "1d", metric: "requests", previous: true, now: CALL_NOW });
    expect(sum(res.points)).toBe(1); // the current curve is intact
    expect(res.previous.length).toBe(res.points.length);
    expect(res.previous.every((p) => p.value === null)).toBe(true);
    expect(res.meta.prevStartMs).toBe(res.meta.startMs - (res.meta.endMs - res.meta.startMs));
  });

  it("period 'all' has no previous window — previous:[] and null prev-bounds", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [row("2026-08-01T00:00:00.000Z"), row(T)]);
    const res = await usageRepo.getFilteredSeries({ period: "all", granularity: "1d", metric: "requests", previous: true, now: CALL_NOW });
    expect(res.previous).toEqual([]);
    expect(res.meta.prevStartMs).toBeNull();
    expect(res.meta.prevEndMs).toBeNull();
    expect(sum(res.points)).toBe(2);
  });
});

// ─── 3. The rollup tier — the default compare path ──────────────────────────

describe("W3-E ghost — rollup tier (7d default, usageDaily)", () => {
  it("previous:true over 7d rides usageDaily and aligns onto the current axis", async () => {
    const { usageRepo } = await boot();
    // 7d window [Aug9T11:00Z, Aug16T11:00Z); previous [Aug2T11:00Z, Aug9T11:00Z).
    // Rollup buckets are local-day floors; the 7d shift is a whole multiple of
    // the 1d bucket, so a current local-day D pairs with prev local-day D−7.
    await seed(usageRepo, [
      row("2026-08-05T09:00:00.000Z"), // prev local-day Aug5 → pairs with cur Aug12
      row("2026-08-07T09:00:00.000Z"), // prev local-day Aug7 → pairs with cur Aug14
      row("2026-08-12T09:00:00.000Z"), // cur local-day Aug12
      row("2026-08-14T09:00:00.000Z"), // cur local-day Aug14
    ]);
    const res = await usageRepo.getFilteredSeries({ period: "7d", granularity: "1d", metric: "requests", previous: true, now: CALL_NOW });

    expect(res.meta.source).toBe("usageDaily"); // 7d > 3d exact threshold
    expect(sum(res.points)).toBe(2);
    expect(res.previous.length).toBe(res.points.length);
    expect(res.previous.map((p) => p.t)).toEqual(res.points.map((p) => p.t));
    // Whole-bucket alignment over the rollup too — both prev twins resolve.
    expect(sum(res.previous.filter((p) => p.value !== null))).toBe(2);
    expect(res.previous.every((p) => p.value === 1)).toBe(true);
  });
});

// ─── 4. The identifier covenant still stands ────────────────────────────────

describe("W3-E ghost — identifier covenant", () => {
  it("previous:true does not loosen validation — unknown identifiers still 400-shaped", async () => {
    const { usageRepo } = await boot();
    const probes = [
      () => usageRepo.getFilteredSeries({ period: "bogus", previous: true }),
      () => usageRepo.getFilteredSeries({ granularity: "3h", previous: true }),
      () => usageRepo.getFilteredSeries({ metric: "vibes", previous: true }),
    ];
    for (const probe of probes) {
      await expect(probe()).rejects.toMatchObject({ code: "INVALID_FILTER_PARAM" });
    }
  });

  it("parsePrevious shape-shapes only '1' and 'true'", async () => {
    const { parsePrevious } = await import("@/app/api/usage/metrics/_lib/params.js");
    const mk = (v) => new URLSearchParams(v === null ? {} : { previous: v });
    expect(parsePrevious(mk("1"))).toBe(true);
    expect(parsePrevious(mk("true"))).toBe(true);
    expect(parsePrevious(mk("0"))).toBe(false);
    expect(parsePrevious(mk("false"))).toBe(false);
    expect(parsePrevious(mk("yes"))).toBe(false);
    expect(parsePrevious(mk(null))).toBe(false);
  });
});
