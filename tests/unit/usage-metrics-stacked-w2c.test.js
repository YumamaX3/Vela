// Usage Observatory W2-C — the stacked-series engine + API layer.
//
// Covers, against a real sqlite twin:
//   • Identifier covenant at the stacked surface — 400s for dimension,
//     metric, granularity, period (frozen maps, phase13 R8).
//   • Exact tier (≤3d): time × dimension bucketing, top-N + Other folding.
//   • Rollup tier (7d+): usageDaily day-group traversal, statusClass funded
//     from statusByProvider (requests-only — cost/token per status refuses
//     loud rather than fabricate).
//   • The breakdown rollup repair: dimension=statusClass no longer falls
//     through to byEndpoint.
//   • Twin parity: facade + sqlite + mysql exports + USAGE_WAVE_NAMES.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w2c-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w2c-secret";
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

/** Seed 6 rows within the last hour, two providers × two models. */
async function seedRows(saveRequestUsage, now) {
  for (let i = 0; i < 6; i++) {
    await saveRequestUsage({
      timestamp: new Date(now - i * 60_000).toISOString(),
      provider: i % 2 === 0 ? "openai" : "anthropic",
      model: i % 2 === 0 ? "gpt-4o" : "claude-sonnet-4",
      status: "ok",
      latencyMs: 100 + i * 50,
      httpStatus: 200,
      tokens: { prompt_tokens: 100 + i, completion_tokens: 50 },
      cost: 0.001 * (i + 1),
    });
  }
}

const localDateKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Plant a usageDaily rollup day directly (the reader's contract: dateKey +
 *  data JSON — the same shape the rollup writer produces). */
async function plantDay(db, dateKey, dayData) {
  await db.run(
    "INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)",
    [dateKey, JSON.stringify(dayData)]
  );
}

describe("W2-C stacked — identifier covenant 400s (phase13 R8)", () => {
  it("rejects an unknown dimension", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "dimension=tenant"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_FILTER_PARAM");
    expect(body.field).toBe("dimension");
  });

  it("rejects an unknown metric", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "metric=vibes"));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("metric");
  });

  it("rejects an unknown granularity", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "gran=1w"));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("granularity");
  });

  it("rejects an unknown period", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=13moons"));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("period");
  });
});

describe("W2-C stacked — exact tier (≤3d)", () => {
  it("returns per-dimension series with bucketed points + source meta", async () => {
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=24h&gran=1h&metric=requests&dimension=provider"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.source).toBe("usageHistory");
    expect(body.meta.topN).toBe(6);
    expect(body.series.length).toBe(2);

    const openai = body.series.find((s) => s.key === "openai");
    const anthropic = body.series.find((s) => s.key === "anthropic");
    expect(openai.total).toBe(3);
    expect(anthropic.total).toBe(3);
    // Every point is a {t, value} aligned to the hour bucket.
    const HOUR = 3_600_000;
    for (const s of body.series) {
      for (const p of s.points) {
        expect(p.t % HOUR).toBe(0);
        expect(p.value).toBeGreaterThan(0);
      }
    }
    const grand = body.series.reduce((sum, s) => sum + s.total, 0);
    expect(grand).toBe(6);
  });

  it("cost metric — series totals equal the sum of their bucketed points", async () => {
    // saveRequestUsage re-derives cost from the pricing module (a caller-
    // supplied cost never persists), so the golden-sum proof for cost lives
    // in the rollup tier below (days planted directly). Here the engine's
    // contract is internal consistency: each series' total equals its points.
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=24h&gran=1h&metric=cost"));
    const body = await res.json();
    expect(body.series.length).toBe(2);
    for (const s of body.series) {
      const pointSum = s.points.reduce((sum, p) => sum + p.value, 0);
      // round6 per bucket vs round6 of the raw sum — allow ≤1e-5 drift
      expect(Math.abs(pointSum - s.total)).toBeLessThan(1e-5);
    }
  });

  it("folds the long tail into Other beyond top-N", async () => {
    const { saveRequestUsage } = await boot();
    const now = Date.now();
    // Eight providers with descending volume: 8,7,6,5,4,3,2,1 rows.
    for (let p = 1; p <= 8; p++) {
      for (let i = 0; i < 9 - p; i++) {
        await saveRequestUsage({
          timestamp: new Date(now - (p * 10 + i) * 1000).toISOString(),
          provider: `p${p}`,
          model: "m",
          status: "ok",
          tokens: { prompt_tokens: 1 },
          cost: 0,
        });
      }
    }
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=24h&gran=1h&metric=requests"));
    const body = await res.json();
    expect(body.series.length).toBe(7); // top-6 + Other
    const keys = body.series.map((s) => s.key);
    expect(keys.slice(0, 6)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(keys[6]).toBe("Other");
    const other = body.series[6];
    expect(other.total).toBe(3); // p7 (2 rows) + p8 (1 row)
    // Other's points fold both tails' buckets.
    const grand = body.series.reduce((sum, s) => sum + s.total, 0);
    expect(grand).toBe(36); // 8+7+6+5+4+3+2+1
  });
});

describe("W2-C stacked — rollup tier (7d+)", () => {
  it("reads usageDaily day-groups, O(days), with day-bucketed points", async () => {
    const { db } = await boot();
    const now = Date.now();
    await plantDay(db, localDateKey(now), {
      requests: 10, cost: 0.5,
      byProvider: { openai: { requests: 6, cost: 0.3 }, anthropic: { requests: 4, cost: 0.2 } },
    });
    await plantDay(db, localDateKey(now - 86_400_000), {
      requests: 5, cost: 0.25,
      byProvider: { openai: { requests: 5, cost: 0.25 } },
    });
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=7d&gran=1d&metric=cost&dimension=provider"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.source).toBe("usageDaily");
    const openai = body.series.find((s) => s.key === "openai");
    const anthropic = body.series.find((s) => s.key === "anthropic");
    expect(Math.round(openai.total * 1e6) / 1e6).toBe(0.55); // 0.3 + 0.25
    expect(openai.points.length).toBe(2); // one bucket per day
    expect(Math.round(anthropic.total * 1e6) / 1e6).toBe(0.2);
  });

  it("honors the dimension's own filter at the rollup tier", async () => {
    const { db } = await boot();
    const now = Date.now();
    await plantDay(db, localDateKey(now), {
      requests: 10, cost: 0.5,
      byProvider: { openai: { requests: 6, cost: 0.3 }, anthropic: { requests: 4, cost: 0.2 } },
    });
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=7d&gran=1d&metric=requests&prov=openai"));
    const body = await res.json();
    expect(body.series.length).toBe(1);
    expect(body.series[0].key).toBe("openai");
    expect(body.series[0].total).toBe(6);
  });

  it("statusClass rides statusByProvider at the rollup tier (requests only)", async () => {
    const { db } = await boot();
    const now = Date.now();
    await plantDay(db, localDateKey(now), {
      requests: 10,
      statusByProvider: {
        openai: { ok: 5, errors: 2, timeout: 2 },
        anthropic: { ok: 3 },
      },
    });
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=7d&gran=1d&metric=requests&dimension=statusClass"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ok = body.series.find((s) => s.key === "ok");
    const timeout = body.series.find((s) => s.key === "timeout");
    expect(ok.total).toBe(8); // 5 + 3
    expect(timeout.total).toBe(2);
    // `errors` is the sum of the individual classes — never its own series
    // (the partition stays honest, never double-counted).
    expect(body.series.find((s) => s.key === "errors")).toBeUndefined();
  });

  it("statusClass × non-requests metric refuses loud at the rollup tier", async () => {
    const { db } = await boot();
    await plantDay(db, localDateKey(Date.now()), { requests: 1 });
    const { GET } = await import("@/app/api/usage/metrics/stacked/route.js");
    const res = await GET(req("/api/usage/metrics/stacked", "period=7d&dimension=statusClass&metric=cost"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("metric");
  });
});

describe("W2-C breakdown repair — statusClass no longer falls into byEndpoint", () => {
  it("breakdown rollup tier funds statusClass from statusByProvider", async () => {
    const { db } = await boot();
    const now = Date.now();
    await plantDay(db, localDateKey(now), {
      requests: 10,
      byEndpoint: { "/v1/chat|gpt-4o|openai": { requests: 10, cost: 0.5 } },
      statusByProvider: { openai: { ok: 5, errors: 2, timeout: 2 } },
    });
    const { GET } = await import("@/app/api/usage/metrics/breakdown/route.js");
    const res = await GET(req("/api/usage/metrics/breakdown", "period=7d&dimension=statusClass&metric=requests"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ok = body.items.find((i) => i.statusClass === "ok");
    const timeout = body.items.find((i) => i.statusClass === "timeout");
    expect(ok.value).toBe(5);
    expect(timeout.value).toBe(2);
    // The old fall-through would have surfaced the endpoint key instead.
    expect(body.items.find((i) => String(i.statusClass).startsWith("/v1"))).toBeUndefined();
  });

  it("breakdown rollup tier refuses statusClass × cost loudly", async () => {
    const { db } = await boot();
    await plantDay(db, localDateKey(Date.now()), { requests: 1 });
    const { GET } = await import("@/app/api/usage/metrics/breakdown/route.js");
    const res = await GET(req("/api/usage/metrics/breakdown", "period=7d&dimension=statusClass&metric=cost"));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("metric");
  });
});

describe("W2-C twin parity — the stacked surface rides the full chain", () => {
  it("facade + both harbor twins export getStackedSeries; bind gate carries it", async () => {
    await boot();
    const facade = await import("@/lib/db/repos/usageRepo.js");
    const sqlite = await import("@/lib/db/repos/sqlite/usageRepo.js");
    const mysql = await import("@/lib/db/repos/mysql/usageRepo.js");
    expect(typeof facade.getStackedSeries).toBe("function");
    expect(typeof sqlite.getStackedSeries).toBe("function");
    expect(typeof mysql.getStackedSeries).toBe("function");
    const bindSrc = fs.readFileSync(
      path.resolve(__dirname, "../../src/lib/db/repos/bind.js"),
      "utf8"
    );
    expect(bindSrc).toContain('"getStackedSeries"'); // USAGE_WAVE_NAMES member
  });
});
