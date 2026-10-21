// Compression analytics — reads the rtk receipts already in usageHistory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-compress-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.MODE = process.env.VELA_DB_MODE;
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function seed() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  const adapter = await getAdapter();
  const now = new Date();
  const insert = (timestamp, provider, model, prompt, completion, tokens, meta, latency) => {
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, endpoint, promptTokens, completionTokens, tokens, meta, latencyMs, status)
       VALUES(?, ?, ?, '', '', 'chat', ?, ?, ?, ?, ?, 'success')`,
      [timestamp, provider, model, prompt, completion, JSON.stringify(tokens), JSON.stringify(meta), latency]
    );
  };
  insert(now.toISOString(), "openai", "gpt-x", 1000, 100, { cached_tokens: 200 },
    { rtk: { bytesSaved: 400, tokensSavedEst: 500 }, rtkSavedCostUsd: 0.002 }, 120);
  insert(new Date(now.getTime() - 3600_000).toISOString(), "anthropic", "claude-x", 2000, 200, {},
    { rtk: { bytesSaved: 800 } }, 80);
  insert(new Date(now.getTime() - 7200_000).toISOString(), "openai", "gpt-x", 100, 10, {}, {}, 50);
}

describe("compression analytics", () => {
  it("aggregates the rtk receipts without inventing data", async () => {
    await seed();
    const { getCompressionAnalyticsSummary } = await import("@/lib/db/repos/compressionAnalyticsRepo.js");
    const summary = await getCompressionAnalyticsSummary({ period: "24h" });

    expect(summary.totalRequests).toBe(2);
    expect(summary.totalTokensSaved).toBe(700); // 500 est + floor(800/4)
    expect(summary.byMode.rtk).toMatchObject({ count: 2, tokensSaved: 700 });
    expect(summary.byProvider.openai).toMatchObject({ count: 1, tokensSaved: 500 });
    expect(summary.byProvider.anthropic).toMatchObject({ count: 1, tokensSaved: 200 });
    expect(summary.byModel["gpt-x"].count).toBe(1);
    expect(summary.realUsage.requestsWithReceipts).toBe(3);
    expect(summary.realUsage.cacheReadTokens).toBe(200);
    expect(summary.realUsage.estimatedUsdSaved).toBeCloseTo(0.002);
    expect(summary.trend.length).toBeGreaterThan(0);
    expect(summary.avgSavingsPct).toBeGreaterThan(0);
  });

  it("serves the route with the echoed period", async () => {
    await seed();
    const { GET } = await import("@/app/api/analytics/compression/route.js");
    const res = await GET(new Request("http://localhost/api/analytics/compression?period=24h"));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.period).toBe("24h");
    expect(payload.totalRequests).toBe(2);

    const all = await (await GET(new Request("http://localhost/api/analytics/compression"))).json();
    expect(all.period).toBe("all");
    expect(all.totalRequests).toBe(2);
  });
});
