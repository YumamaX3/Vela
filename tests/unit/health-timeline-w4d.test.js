// Usage Observatory W4-D — provider health timeline strips contract test.
//
// Covers, against a real sqlite twin (route handler invoked directly — the
// dashboardGuard middleware marks the "/api/usage" prefix protected at the
// edge, so route-level tests pin the handler contract, not the middleware):
//   • exact tier (≤3d): day axis is the local calendar days of the window;
//     cells partition ok/errors with the dominant class named
//   • hollow cells for a provider's empty day (no fabricated clean)
//   • provider facet filters the exact tier; strips sort by traffic desc
//   • rollup tier (7d+): reads usageDaily.statusByProvider — source honest,
//     day keys identical, provider facet honored; pre-telemetry days hollow
//   • the day axis never exceeds the cap; unknown period → honest 400
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w4d-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w4d-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  delete global._usageEnrichmentCache; // fresh enrichment per test world
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
  return getAdapter();
}

const DAY = 86_400_000;
const localKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Seed usageHistory rows; statusClass is taken verbatim (W1-A convention). */
async function seed(rows) {
  const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
  for (const r of rows) {
    await saveRequestUsage({
      provider: r.provider || "openai",
      model: r.model || "gpt-4o",
      status: r.status || "ok",
      statusClass: r.statusClass || "ok",
      latencyMs: r.latencyMs ?? 120,
      httpStatus: r.httpStatus ?? 200,
      tokens: { prompt_tokens: 100, completion_tokens: 40 },
      cost: 0.003,
      timestamp: new Date(r.ts).toISOString(),
    });
  }
}

/** Seed the usageDaily rollup directly (a pre-aggregated day). */
async function seedRollupDay(dateKey, data) {
  const db = await boot();
  db.run(
    `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
    [dateKey, JSON.stringify(data)]
  );
}

function routeReq(qs = "") {
  return new Request(`http://localhost/api/usage/metrics/health-timeline${qs ? `?${qs}` : ""}`);
}

describe("W4-D health timeline — exact tier (≤3d)", () => {
  it("the day axis is the local calendar days of the window", async () => {
    await boot();
    const now = Date.now();
    await seed([{ provider: "openai", ts: now - 10 * 60_000 }]);
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const res = await GET(routeReq("period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.source).toBe("usageHistory");
    // The axis covers every local day the 24h window touches — one OR two
    // (a window ending after local midnight reaches back into yesterday).
    expect(body.days).toContain(localKey(now));
    expect(body.days.length).toBeGreaterThanOrEqual(1);
    expect(body.days.length).toBeLessThanOrEqual(2);
    expect(body.strips).toHaveLength(1);
    expect(body.strips[0].cells).toHaveLength(body.days.length); // cell-per-day
    const todayCell = body.strips[0].cells.find((c) => c.date === localKey(now));
    expect(todayCell.requests).toBe(1);
  });

  it("cells partition ok/errors and name the dominant class", async () => {
    await boot();
    const now = Date.now();
    // Staggered timestamps — migration 004's dedupe UNIQUE collapses rows
    // sharing (timestamp, provider, model, tokens); five rows at one
    // millisecond would become one.
    const ts = (i) => now - (30 + i) * 60_000;
    await seed([
      { provider: "openai", ts: ts(0), statusClass: "ok", status: "ok" },
      { provider: "openai", ts: ts(1), statusClass: "ok", status: "ok" },
      { provider: "openai", ts: ts(2), statusClass: "upstream_error", status: "error", httpStatus: 500 },
      { provider: "openai", ts: ts(3), statusClass: "upstream_error", status: "error", httpStatus: 502 },
      { provider: "openai", ts: ts(4), statusClass: "timeout", status: "timeout", httpStatus: 504 },
    ]);
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const body = await (await GET(routeReq("period=24h"))).json();
    // Find TODAY's cell — cells[0] is the axis's first day, which may be
    // yesterday when the wall clock runs past local midnight.
    const cell = body.strips[0].cells.find((c) => c.date === localKey(now));
    expect(cell.requests).toBe(5);
    expect(cell.errors).toBe(3);
    expect(cell.dominant).toBe("upstream_error"); // 2 > 1
    expect(body.strips[0].totalRequests).toBe(5);
    expect(body.strips[0].totalErrors).toBe(3);
  });

  it("a provider's empty day renders a hollow cell, never a fabricated clean", async () => {
    await boot();
    const now = Date.now();
    // Traffic yesterday only; today's window cell must stay hollow.
    await seed([{ provider: "anthropic", ts: now - DAY - 60_000 }]);
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const body = await (await GET(routeReq("period=3d"))).json();
    const strip = body.strips[0];
    expect(strip.provider).toBe("anthropic");
    const todayCell = strip.cells.find((c) => c.date === localKey(now));
    expect(todayCell).toBeTruthy();
    expect(todayCell.requests).toBe(0);
    expect(todayCell.dominant).toBeNull();
  });

  it("the provider facet filters the exact tier; strips sort by traffic desc", async () => {
    await boot();
    const now = Date.now();
    await seed([
      { provider: "openai", ts: now - 60_000 },
      { provider: "openai", ts: now - 120_000 },
      { provider: "anthropic", ts: now - 180_000 },
    ]);
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");

    const unfiltered = await (await GET(routeReq("period=24h"))).json();
    expect(unfiltered.strips.map((s) => s.provider)).toEqual(["openai", "anthropic"]); // 2 > 1

    const filtered = await (await GET(routeReq("period=24h&prov=anthropic"))).json();
    expect(filtered.strips).toHaveLength(1);
    expect(filtered.strips[0].provider).toBe("anthropic");
  });
});

describe("W4-D health timeline — rollup tier (7d+)", () => {
  it("reads usageDaily.statusByProvider with honest source + identical day keys", async () => {
    await boot();
    const now = Date.now();
    const y = localKey(now - DAY);
    const d2 = localKey(now - 2 * DAY);
    await seedRollupDay(y, {
      requests: 10,
      statusByProvider: { openai: { ok: 7, errors: 3, upstream_error: 2, timeout: 1 } },
    });
    await seedRollupDay(d2, {
      requests: 4,
      statusByProvider: { openai: { ok: 4 } },
    });

    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const body = await (await GET(routeReq("period=7d"))).json();
    expect(body.meta.source).toBe("usageDaily.statusByProvider");
    expect(body.days).toContain(y);
    expect(body.days).toContain(d2);

    const strip = body.strips.find((s) => s.provider === "openai");
    expect(strip).toBeTruthy();
    const yCell = strip.cells.find((c) => c.date === y);
    expect(yCell.requests).toBe(10);
    expect(yCell.errors).toBe(3);
    expect(yCell.dominant).toBe("upstream_error");
    const d2Cell = strip.cells.find((c) => c.date === d2);
    expect(d2Cell.requests).toBe(4);
    expect(d2Cell.errors).toBe(0);
  });

  it("pre-telemetry days (no statusByProvider) render hollow, not guessed", async () => {
    await boot();
    const now = Date.now();
    const old = localKey(now - 2 * DAY);
    await seedRollupDay(old, { requests: 5, byProvider: { openai: { requests: 5 } } }); // pre-008 shape
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const body = await (await GET(routeReq("period=7d"))).json();
    // The day is on the axis, but no provider touched it via telemetry →
    // no strip claims it. Honest: never a fabricated clean.
    expect(body.days).toContain(old);
    expect(body.strips.filter((s) => s.cells.some((c) => c.date === old && c.requests > 0))).toEqual([]);
  });

  it("the provider facet rides the rollup tier too", async () => {
    await boot();
    const now = Date.now();
    const y = localKey(now - DAY);
    await seedRollupDay(y, {
      requests: 12,
      statusByProvider: {
        openai: { ok: 8, errors: 2, upstream_error: 2 },
        anthropic: { ok: 2 },
      },
    });
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const body = await (await GET(routeReq("period=7d&prov=openai"))).json();
    expect(body.strips.map((s) => s.provider)).toEqual(["openai"]);
  });
});

describe("W4-D health timeline — the guard rails", () => {
  it("the day axis never exceeds the cap (period=all)", async () => {
    await boot();
    const now = Date.now();
    await seed([{ provider: "openai", ts: now - 60_000 }]);
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const body = await (await GET(routeReq("period=all"))).json();
    const { HEALTH_TIMELINE_MAX_DAYS } = await import("@/lib/db/usageAggregation");
    expect(body.days.length).toBeLessThanOrEqual(HEALTH_TIMELINE_MAX_DAYS);
  });

  it("unknown period → honest 400 INVALID_FILTER_PARAM", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/health-timeline/route.js");
    const res = await GET(routeReq("period=bogus"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.code || body.error || "")).toMatch(/INVALID_FILTER_PARAM|unknown period/);
  });
});
