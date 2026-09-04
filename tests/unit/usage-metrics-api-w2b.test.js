// Usage Observatory W2-B — the Metrics REST API layer (sealed plan W2(b) +
// phase13 security obligations).
//
// Covers, against a real sqlite twin:
//   • Identifier covenant at the API surface — one 400 per frozen map
//     (granularity, metric, dimension, period, sort) + malformed `after`.
//   • CSV formula-injection padding (=,+,-,@-leading cells padded with a tab).
//   • Concurrent-export rejection (single-flight lock → 429 EXPORT_IN_PROGRESS).
//   • Happy paths: kpis / timeseries / breakdown / percentiles / ledger shapes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w2b-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w2b-secret";
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
  for (let i = 0; i < 6; i++) {
    await saveRequestUsage({
      timestamp: iso(now - i * 60_000),
      provider: i % 2 === 0 ? "openai" : "anthropic",
      model: i % 2 === 0 ? "gpt-4o" : "claude-sonnet-4",
      status: i === 5 ? "error" : "ok",
      latencyMs: 100 + i * 50,
      httpStatus: i === 5 ? 500 : 200,
      tokens: { prompt_tokens: 100 + i, completion_tokens: 50 },
      cost: 0.001 * (i + 1),
    });
  }
}

describe("W2-B Metrics API — identifier covenant 400s (phase13 R8)", () => {
  it("timeseries rejects an unknown granularity (GRANULARITIES map)", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/timeseries/route.js");
    const res = await GET(req("/api/usage/metrics/timeseries", "period=7d&gran=bogus"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_FILTER_PARAM");
    expect(body.field).toBe("granularity");
  });

  it("timeseries rejects an unknown metric (METRICS map)", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/timeseries/route.js");
    const res = await GET(req("/api/usage/metrics/timeseries", "metric=dropped_table"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("metric");
  });

  it("breakdown rejects an unknown dimension (DIMENSIONS map)", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/breakdown/route.js");
    const res = await GET(req("/api/usage/metrics/breakdown", "dimension=tenant"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("dimension");
  });

  it("percentiles rejects an unknown period (PERIODS map)", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/percentiles/route.js");
    const res = await GET(req("/api/usage/metrics/percentiles", "period=13moons"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("period");
  });

  it("ledger rejects an unknown sort column (SORTABLE_COLUMNS map)", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");
    const res = await GET(req("/api/usage/metrics/ledger", "sort=secret_column"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("sort");
  });

  it("ledger rejects a malformed after cursor with 400", async () => {
    await boot();
    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");
    const res = await GET(req("/api/usage/metrics/ledger", "after=not-json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("after");
  });
});

describe("W2-B Metrics API — happy-path shapes", () => {
  it("kpis returns current + previous windows with deltas", async () => {
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/kpis/route.js");
    const res = await GET(req("/api/usage/metrics/kpis", "period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests.value).toBe(6);
    expect(body.requests.previous).toBe(0);
    expect(body.requests.delta).toBe(6);
    expect(body.cost.value).toBeGreaterThan(0);
    expect(body.meta.period).toBe("24h");
  });

  it("timeseries returns bucketed points + meta.source", async () => {
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/timeseries/route.js");
    const res = await GET(req("/api/usage/metrics/timeseries", "period=24h&gran=1h&metric=requests"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.points)).toBe(true);
    expect(body.points.length).toBeGreaterThan(0);
    expect(body.meta.source).toBe("usageHistory"); // ≤3d → exact tier
    const total = body.points.reduce((s, p) => s + p.value, 0);
    expect(total).toBe(6);
  });

  it("breakdown returns items keyed by dimension", async () => {
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/breakdown/route.js");
    const res = await GET(req("/api/usage/metrics/breakdown", "period=24h&dimension=provider&metric=requests"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const openai = body.items.find((i) => i.provider === "openai");
    const anthropic = body.items.find((i) => i.provider === "anthropic");
    expect(openai.value).toBe(3);
    expect(anthropic.value).toBe(3);
  });

  it("percentiles returns latency + honesty meta", async () => {
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/percentiles/route.js");
    const res = await GET(req("/api/usage/metrics/percentiles", "period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latency.p50).toBeGreaterThan(0);
    expect(body.meta.count).toBe(6);
    expect(body.meta.approximate).toBe(false); // exact tier ≤3d
  });

  it("ledger returns items + nextCursor contract", async () => {
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");
    const page1 = await GET(req("/api/usage/metrics/ledger", "period=24h&limit=4"));
    expect(page1.status).toBe(200);
    const b1 = await page1.json();
    expect(b1.items.length).toBe(4);
    expect(b1.nextCursor).not.toBeNull();

    const page2 = await GET(req("/api/usage/metrics/ledger", `period=24h&limit=4&after=${encodeURIComponent(JSON.stringify(b1.nextCursor))}`));
    const b2 = await page2.json();
    expect(b2.items.length).toBe(2); // 6 total, walked 4, 2 remain
    // Keyset walk never repeats a row.
    const ids = new Set([...b1.items, ...b2.items].map((r) => r.id));
    expect(ids.size).toBe(6);
  });
});

describe("W2-B Metrics API — export safety (phase13)", () => {
  it("CSV cells beginning =,+,-,@ are padded with a leading tab (formula injection)", async () => {
    const { saveRequestUsage } = await boot();
    const now = Date.now();
    // Hostile cell values in user-influenced columns.
    const hostile = ["=cmd|'/c calc'!A0", "+SUM(A1:A2)", "-1+1", "@SUM(A1)"];
    for (let i = 0; i < hostile.length; i++) {
      await saveRequestUsage({
        timestamp: new Date(now - i * 1000).toISOString(),
        provider: "openai",
        model: hostile[i],
        status: "ok",
        tokens: { prompt_tokens: 1 },
        cost: 0,
      });
    }
    const { GET } = await import("@/app/api/usage/metrics/export/route.js");
    const res = await GET(req("/api/usage/metrics/export", "period=24h"));
    expect(res.status).toBe(200);
    const csv = await res.text();

    // Every hostile cell must appear as "\t<value>" — quoted, tab-padded.
    for (const h of hostile) {
      expect(csv).toContain(`"\t${h}"`);
      // And never as a bare formula-leading unquoted cell.
      expect(csv.includes(`\n${h},`) || csv.startsWith(`${h},`)).toBe(false);
    }
    // Header row is quoted too.
    expect(csv.startsWith('"id","timestamp"')).toBe(true);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="vela-usage-export.csv"');
  });

  it("a concurrent export is rejected with 429 EXPORT_IN_PROGRESS", async () => {
    const { saveRequestUsage } = await boot();
    await seedRows(saveRequestUsage, Date.now());
    const { GET } = await import("@/app/api/usage/metrics/export/route.js");

    // First export: its stream starts immediately and holds the single-flight
    // lock while we hold the body unread.
    const first = await GET(req("/api/usage/metrics/export", "period=24h"));
    expect(first.status).toBe(200);

    const second = await GET(req("/api/usage/metrics/export", "period=24h"));
    expect(second.status).toBe(429);
    expect((await second.json()).error).toBe("EXPORT_IN_PROGRESS");

    // Drain the first so the lock releases (keeps the suite hermetic).
    await first.text();
    const third = await GET(req("/api/usage/metrics/export", "period=24h"));
    expect(third.status).toBe(200);
    await third.text();
  });
});

describe("W2-B guard registration — export escalates, reads stay posture-consistent", () => {
  it("dashboardGuard ALWAYS_PROTECTED carries the export surface; reads ride the deny-by-default branch", async () => {
    // Source-inspection census pin (the middleware enforces these at runtime;
    // the W1 precedent pins registry membership in-repo so a drift fails fast).
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/dashboardGuard.js"),
      "utf8"
    );

    // Pin MEMBERSHIP by slicing the array text, never a positional indexOf
    // comparison. Two reasons, both bitten once already:
    //   1. The old anchor was `const PROTECTED_API_PATHS` — dead code, removed at
    //      v0.9.45 when §5.1's prescribed edit was reconciled against the real
    //      guard (commit bb868085 had orphaned the list). indexOf returned -1.
    //   2. A positional anchor on a string that also appears in a COMMENT measures
    //      the comment, not the code — `pathname.startsWith("/api/")` occurs in
    //      the removal note near the top of the file, so it would resolve before
    //      the export entry and silently invert the ordering assertion.
    const listStart = src.indexOf("const ALWAYS_PROTECTED");
    expect(listStart).toBeGreaterThan(-1);
    const listEnd = src.indexOf("];", listStart);
    expect(listEnd).toBeGreaterThan(listStart);
    const alwaysProtected = src.slice(listStart, listEnd);

    // Exactly two usage surfaces escalate, and both are NAMED LEAVES. There is no
    // bare "/api/usage" prefix entry, so every other usage surface (kpis,
    // timeseries, breakdown, percentiles, ledger, digest, budgets) falls through
    // to the deny-by-default "/api/*" branch in proxy() — JWT-or-requireLogin.
    // That branch is the live mechanism the old pin named by its dead list.
    expect(alwaysProtected.match(/"\/api\/usage[^"]*"/g)).toEqual([
      '"/api/usage/metrics/export"',
      '"/api/usage/views"',
    ]);
    expect(alwaysProtected).not.toContain('"/api/usage"');

    // And the branch they fall through to must still exist, downstream of the
    // escalation check — sliced from proxy() so the comment occurrence above
    // cannot satisfy it.
    const proxyStart = src.indexOf("export async function proxy(");
    expect(proxyStart).toBeGreaterThan(-1);
    expect(
      src.indexOf('pathname.startsWith("/api/")', proxyStart)
    ).toBeGreaterThan(-1);
  });
});
