// Usage Observatory W1-E — the chatCore instrumentation seam (sealed plan item 9).
// W1-B proved the repo write-path persists telemetry. This proves the CHATCORE
// boundary: saveUsageStats() forwards latencyMs/ttftMs/httpStatus/rtk into
// saveRequestUsage, and the repo derives statusClass + funds meta.rtkSavedCostUsd.
// End-to-end through the same seam that streamingHandler/sseToJsonHandler/nonStreamingHandler
// call — a fake-SSE payload in, the instrumented row out.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w1e-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w1e-secret";
  delete process.env.VELA_MYSQL_URL;
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

async function boot() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const { saveUsageStats } = await import("open-sse/handlers/chatCore/requestDetail.js");
  return { db, saveUsageStats };
}

async function lastRow(db) {
  const rows = db.all(`SELECT * FROM usageHistory ORDER BY id DESC LIMIT 1`);
  return rows[0];
}

describe("W1-E — chatCore saveUsageStats forwards telemetry into the row", () => {
  it("streaming path: latency + ttft + httpStatus land in the row", async () => {
    const { db, saveUsageStats } = await boot();
    // The shape streamingHandler's onStreamComplete passes (silent, latency.total/ttft).
    saveUsageStats({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      silent: true, latencyMs: 1234, ttftMs: 120, httpStatus: 200,
    });
    await new Promise((r) => setTimeout(r, 60)); // fire-and-forget write settles
    const row = await lastRow(db);
    expect(row.latencyMs).toBe(1234);
    expect(row.ttftMs).toBe(120);
    expect(row.httpStatus).toBe(200);
    expect(row.statusClass).toBe("ok"); // derived from httpStatus 200
  }, 15_000); // boot() re-imports the full chatCore graph per test — generous
  // under parallel sweep load; the law tested is the row, not boot speed.

  it("forced-SSE-to-JSON path: latency lands, ttft stays NULL (honest)", async () => {
    const { db, saveUsageStats } = await boot();
    // sseToJsonHandler wires latencyMs + httpStatus but ttftMs:null (stream consumed whole).
    saveUsageStats({
      provider: "anthropic", model: "claude-x",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      silent: true, latencyMs: 900, ttftMs: null, httpStatus: 200,
    });
    await new Promise((r) => setTimeout(r, 60));
    const row = await lastRow(db);
    expect(row.latencyMs).toBe(900);
    expect(row.ttftMs).toBeNull(); // never 0-faked
    expect(row.statusClass).toBe("ok");
  }, 15_000);

  it("an upstream 429 classifies as rate_limited through the chatCore seam", async () => {
    const { db, saveUsageStats } = await boot();
    saveUsageStats({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 3, completion_tokens: 0 },
      silent: true, latencyMs: 50, ttftMs: null, httpStatus: 429,
    });
    await new Promise((r) => setTimeout(r, 60));
    const row = await lastRow(db);
    expect(row.httpStatus).toBe(429);
    expect(row.statusClass).toBe("rate_limited");
  }, 15_000);

  it("rtk savings ride the seam and fund $ at the model's input rate", async () => {
    const { db, saveUsageStats } = await boot();
    // Seed a sovereign user pricing override (stratum 1) so funding resolves
    // deterministically — the same kv shape the W1-B suite uses.
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      ["openai", JSON.stringify({ "gpt-4o": { input: 3, output: 15 } })]
    );

    // chatCore builds rtk = {bytesSaved, tokensSavedEst}; 1000 est tokens × $3/1M.
    saveUsageStats({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      silent: true, latencyMs: 100, ttftMs: null, httpStatus: 200,
      rtk: { bytesSaved: 4000, tokensSavedEst: 1000 },
    });
    await new Promise((r) => setTimeout(r, 120));
    const row = await lastRow(db);
    const meta = JSON.parse(row.meta || "{}");
    expect(meta.rtk).toMatchObject({ bytesSaved: 4000, tokensSavedEst: 1000 });
    expect(meta.rtkSavedCostUsd).toBeCloseTo(1000 * (3 / 1e6), 9); // $0.003
  }, 15_000);
});
