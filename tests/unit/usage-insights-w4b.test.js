// Usage Observatory W4-B — auto-insights (the Lookout signal registry).
//
// Two layers proven:
//   A. evaluateInsights — the PURE evaluator (no DB): every threshold, every
//      column guard, the quiet-state, severity ordering, the cap, and the
//      evidence-link shape. Deterministic by construction.
//   B. The route — against a real sqlite twin (handler invoked directly; the
//      dashboardGuard covers "/api/usage" at the edge): quiet world → [],
//      an error-heavy world fires elevated_errors + error_class_dominant,
//      and the identifier covenant still rejects unknown periods.
// Regression judged via the baseline, never raw green — this file is additive.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { evaluateInsights, INSIGHT_THRESHOLDS, MAX_INSIGHTS } from "@/lib/usageInsights.js";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w4b-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
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
  await getAdapter(); // boots schema + migrations
  const usageRepo = await import("@/lib/db/repos/sqlite/usageRepo.js");
  return usageRepo;
}

// ─── A. The pure evaluator ──────────────────────────────────────────────────

const TH = INSIGHT_THRESHOLDS;

/** Build a statusBreakdown shape from {statusClass: count} pairs. */
const statusBk = (pairs) => ({
  items: Object.entries(pairs).map(([statusClass, value]) => ({ statusClass, value })),
});
const provCostBk = (pairs) => ({
  items: Object.entries(pairs).map(([provider, value]) => ({ provider, value }))
    .sort((a, b) => b.value - a.value),
});
const kpis = (curCost, prevCost) => ({ cost: { value: curCost, previous: prevCost, delta: curCost - prevCost } });
const latency = (p95, count) => ({ values: { p50: null, p95, p99: null }, count });

describe("W4-B evaluator — error signals", () => {
  it("fires elevated_errors at the threshold, with honest attribution", () => {
    const out = evaluateInsights({
      statusBreakdown: statusBk({ ok: 92, upstream_error: 8 }),
    });
    // All 8 errors are one class → the dominant-class signal rides along.
    expect(out.map((i) => i.kind)).toEqual(["elevated_errors", "error_class_dominant"]);
    expect(out[0].severity).toBe("medium");
    expect(out[0].params.pct).toBe(8);
    expect(out[0].evidence).toEqual({ tab: "analytics" });
  });

  it("elevated_errors alone when no class dominates the mix", () => {
    // Errors split evenly across classes (25% each) — elevated, never dominant.
    const out = evaluateInsights({
      statusBreakdown: statusBk({ ok: 88, upstream_error: 3, timeout: 3, client_error: 3, rate_limited: 3 }),
    });
    expect(out.map((i) => i.kind)).toEqual(["elevated_errors"]);
    expect(out[0].params.pct).toBe(12);
  });

  it("stays quiet below the threshold and below the sample floor", () => {
    // 7% errors — below the 8% trigger.
    expect(evaluateInsights({ statusBreakdown: statusBk({ ok: 93, upstream_error: 7 }) })).toEqual([]);
    // Tiny sample — 5/10 is 50% but the minTotalRequests floor protects it.
    expect(evaluateInsights({ statusBreakdown: statusBk({ ok: 5, upstream_error: 5 }) })).toEqual([]);
  });

  it("unclassified rows are excluded from the denominator, never counted", () => {
    // 10 errors over 100 classified; the 1000 unclassified rows must not
    // dilute the rate to 0.99%.
    const out = evaluateInsights({
      statusBreakdown: statusBk({ ok: 90, client_error: 10, "": 1000 }),
    });
    expect(out.map((i) => i.kind)).toContain("elevated_errors");
    expect(out.find((i) => i.kind === "elevated_errors").params.pct).toBe(10);
  });

  it("escalates to high at ≥20% and names the dominant class", () => {
    const out = evaluateInsights({
      statusBreakdown: statusBk({ ok: 70, timeout: 25, upstream_error: 5 }),
    });
    const kinds = out.map((i) => i.kind);
    expect(kinds).toEqual(["elevated_errors", "error_class_dominant"]);
    expect(out[0].severity).toBe("high");
    const dom = out.find((i) => i.kind === "error_class_dominant");
    expect(dom.params.statusClass).toBe("timeout");
    expect(dom.params.pct).toBe(Math.round((25 / 30) * 1000) / 10);
  });

  it("error_class_dominant only speaks inside an elevated window", () => {
    // One class owns 100% of errors, but the error rate itself is 2% — quiet.
    const out = evaluateInsights({
      statusBreakdown: statusBk({ ok: 98, timeout: 2 }),
    });
    expect(out).toEqual([]);
  });
});

describe("W4-B evaluator — cost signals", () => {
  it("fires cost_concentration with the provider attribution + deep-link", () => {
    const out = evaluateInsights({
      statusBreakdown: statusBk({ ok: 100 }),
      providerCost: provCostBk({ openai: 0.8, anthropic: 0.2 }),
    });
    expect(out.map((i) => i.kind)).toEqual(["cost_concentration"]);
    expect(out[0].params.provider).toBe("openai");
    expect(out[0].params.pct).toBe(80);
    expect(out[0].evidence).toEqual({ tab: "overview", prov: "openai" });
  });

  it("stays quiet below the share floor and below the noise floor", () => {
    // 55% — under the 60% trigger.
    expect(evaluateInsights({ providerCost: provCostBk({ a: 0.55, b: 0.45 }) })).toEqual([]);
    // 100% concentration but $0.001 total — noise never accuses.
    expect(evaluateInsights({ providerCost: provCostBk({ a: 0.001 }) })).toEqual([]);
  });

  it("fires cost_spike when the window doubles over its predecessor", () => {
    const out = evaluateInsights({
      kpis: kpis(0.05, 0.02),
      statusBreakdown: statusBk({ ok: 100 }),
    });
    expect(out.map((i) => i.kind)).toEqual(["cost_spike"]);
    expect(out[0].severity).toBe("high");
    expect(out[0].params.times).toBe(2.5);
  });

  it("cost_spike honors the $ floor and the empty-previous silence", () => {
    // 10× but only half a cent — under the spike floor.
    expect(evaluateInsights({ kpis: kpis(0.005, 0.0005) })).toEqual([]);
    // No previous window — nothing to compare, nothing to say.
    expect(evaluateInsights({ kpis: kpis(0.05, 0) })).toEqual([]);
  });
});

describe("W4-B evaluator — latency signal", () => {
  it("fires high_latency at p95 ≥ threshold with the sample guard", () => {
    const out = evaluateInsights({
      statusBreakdown: statusBk({ ok: 100 }),
      latency: latency(6000, TH.minLatencySample),
    });
    expect(out.map((i) => i.kind)).toEqual(["high_latency"]);
    expect(out[0].severity).toBe("medium");
    expect(out[0].params.secs).toBe("6.0");
  });

  it("escalates at the high threshold; stays quiet below sample floor", () => {
    const high = evaluateInsights({ latency: latency(12000, TH.minLatencySample) });
    expect(high[0].severity).toBe("high");
    // Plenty slow but only 10 telemetry samples — pre-008 column guard.
    expect(evaluateInsights({ latency: latency(12000, 10) })).toEqual([]);
    // Missing telemetry entirely (count absent) — silence, never a fake zero.
    expect(evaluateInsights({ latency: latency(null, 0) })).toEqual([]);
  });
});

describe("W4-B evaluator — registry discipline", () => {
  it("orders high before medium and caps at MAX_INSIGHTS", () => {
    const out = evaluateInsights({
      kpis: kpis(0.1, 0.01), // cost_spike (high)
      statusBreakdown: statusBk({ ok: 70, timeout: 30 }), // elevated high + dominant
      providerCost: provCostBk({ openai: 1 }), // concentration (medium)
      latency: latency(12000, TH.minLatencySample), // latency (high)
    });
    expect(out.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    const sev = out.map((i) => i.severity);
    expect(sev).toEqual([...sev].sort((a, b) => (a === "high" ? 0 : 1) - (b === "high" ? 0 : 1)));
  });

  it("every insight carries kind + severity + i18nKey + evidence (the contract)", () => {
    const out = evaluateInsights({
      kpis: kpis(0.1, 0.01),
      statusBreakdown: statusBk({ ok: 70, timeout: 30 }),
      latency: latency(12000, TH.minLatencySample),
    });
    for (const ins of out) {
      expect(ins.kind).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(ins.severity);
      expect(typeof ins.i18nKey).toBe("string");
      expect(ins.evidence && typeof ins.evidence).toBe("object");
      expect(ins.evidence.tab).toBeTruthy();
    }
  });

  it("a null world is a quiet world — never a crash", () => {
    expect(evaluateInsights({})).toEqual([]);
    expect(evaluateInsights()).toEqual([]);
  });
});

// ─── B. The route, against a real sqlite twin ───────────────────────────────

describe("W4-B insights route — the Lookout's feed", () => {
  // The route uses wall-clock time (like every sibling metrics route — no
  // `now` param), so rows are seeded relative to Date.now().
  async function seed(usageRepo, n, { errors = 0, latencyMs = 100 } = {}) {
    const base = Date.now();
    for (let i = 0; i < n; i++) {
      await usageRepo.saveRequestUsage({
        timestamp: new Date(base - (n - i) * 1000).toISOString(),
        provider: "openai", model: "gpt-4o", endpoint: "/v1/chat",
        status: i < errors ? "error" : "ok",
        tokens: { prompt_tokens: 10, completion_tokens: 5 },
        latencyMs, httpStatus: i < errors ? 500 : 200,
      });
    }
  }

  async function route() {
    return import("@/app/api/usage/metrics/insights/route.js");
  }

  it("quiet world → honest empty list + meta", async () => {
    const usageRepo = await boot();
    await seed(usageRepo, 5);
    const r = await route();
    const res = await r.GET(new Request(`http://localhost/api/usage/metrics/insights?period=24h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("error-heavy world fires elevated_errors through the full stack", async () => {
    const usageRepo = await boot();
    await seed(usageRepo, 30, { errors: 6 }); // 20% upstream_error
    const r = await route();
    const res = await r.GET(new Request(`http://localhost/api/usage/metrics/insights?period=24h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const kinds = body.insights.map((i) => i.kind);
    expect(kinds).toContain("elevated_errors");
    // 6/6 errors are upstream_error → the dominant-class signal rides along.
    expect(kinds).toContain("error_class_dominant");
  });

  it("the identifier covenant still guards the route — unknown period → 400", async () => {
    await boot();
    const r = await route();
    const res = await r.GET(new Request(`http://localhost/api/usage/metrics/insights?period=bogus`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_FILTER_PARAM");
  });
});
