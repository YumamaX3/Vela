// Usage Observatory W1-B — hot-path instrumentation write contract.
// Proves the sqlite twin writes the telemetry columns honestly (NULL when
// absent, never 0-faked), derives statusClass from exactly what lands in the
// row, funds RTK savings at write time via the model's own input rate, and
// enriches the usageDaily rollup (statusByProvider + latencyBuckets). The
// mysql twin is a verbatim mirror of this code (parity-by-construction);
// W1-E's parity rows prove both legs agree.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-w1b-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function bootRepo() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter(); // boots + migrates to schema 8
  const repo = await import("@/lib/db/repos/sqlite/usageRepo.js");
  return { db, repo };
}

/** Seed a sovereign user pricing override (stratum 1) so funding is
 *  deterministic without touching the static chain. */
function seedPricing(db, provider, model, pricing) {
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [provider, JSON.stringify({ [model]: pricing })]
  );
}

async function readDay(db) {
  const rows = db.all(`SELECT dateKey, data FROM usageDaily`);
  expect(rows.length).toBe(1);
  return JSON.parse(rows[0].data);
}

describe("W1-B — telemetry columns ride the write path", () => {
  it("instrumented write persists latency/TTFT/httpStatus + derived statusClass", async () => {
    const { db, repo } = await bootRepo();
    await repo.saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      latencyMs: 1234, ttftMs: 120, httpStatus: 200,
    });

    const row = db.get(`SELECT * FROM usageHistory`);
    expect(row.latencyMs).toBe(1234);
    expect(row.ttftMs).toBe(120);
    expect(row.httpStatus).toBe(200);
    expect(row.statusClass).toBe("ok"); // httpStatus 200
    expect(row.status).toBe("ok");      // completed usage default
  });

  it("absent measurements stay NULL — never 0-faked", async () => {
    const { db, repo } = await bootRepo();
    await repo.saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const row = db.get(`SELECT * FROM usageHistory`);
    expect(row.latencyMs).toBe(null);
    expect(row.ttftMs).toBe(null);
    expect(row.httpStatus).toBe(null);
    expect(row.statusClass).toBe("ok"); // completed usage is ok, honestly
    const meta = JSON.parse(row.meta);
    expect(meta.rtk).toBeUndefined(); // no savings → no rtk key
  });

  it("instrumented httpStatus wins over the legacy status column", async () => {
    const { db, repo } = await bootRepo();
    // A completed-but-rate-limited upstream: the stored raw status stays the
    // caller's word; statusClass reflects the measurement.
    await repo.saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      status: "ok", httpStatus: 429,
    });

    const row = db.get(`SELECT * FROM usageHistory`);
    expect(row.status).toBe("ok");
    expect(row.statusClass).toBe("rate_limited");
  });
});

describe("W1-B — RTK savings funded at write time", () => {
  it("meta.rtk carries the Gate-14 contract + $ funded at the model's input rate", async () => {
    const { db, repo } = await bootRepo();
    seedPricing(db, "testprov", "gpt-telemetry", { input: 3, output: 15 });

    await repo.saveRequestUsage({
      provider: "testprov", model: "gpt-telemetry",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      rtk: { bytesSaved: 4000, tokensSavedEst: 1000 },
    });

    const row = db.get(`SELECT * FROM usageHistory`);
    const meta = JSON.parse(row.meta);
    expect(meta.rtk.bytesSaved).toBe(4000);
    expect(meta.rtk.tokensSavedEst).toBe(1000);
    // 1000 tokens × $3/1M input = $0.003
    expect(meta.rtkSavedCostUsd).toBeCloseTo(0.003, 9);
  });

  it("unpriceable model: rtk recorded, $ honestly absent", async () => {
    const { db, repo } = await bootRepo();
    await repo.saveRequestUsage({
      provider: "unknown-provider", model: "unpriceable-model",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      rtk: { bytesSaved: 4000, tokensSavedEst: 1000 },
    });

    const row = db.get(`SELECT * FROM usageHistory`);
    const meta = JSON.parse(row.meta);
    expect(meta.rtk.bytesSaved).toBe(4000);
    expect(meta.rtk.tokensSavedEst).toBe(1000);
    expect(meta.rtkSavedCostUsd).toBeUndefined(); // '—' downstream
  });
});

describe("W1-B — usageDaily rollup gains telemetry", () => {
  it("statusByProvider counts ok/errors; latencyBuckets lands the right edge", async () => {
    const { db, repo } = await bootRepo();

    await repo.saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      latencyMs: 1234, httpStatus: 200, // bucket b4 (1–2.5s)
    });
    await repo.saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 11, completion_tokens: 6 }, // distinct dedupe group
      latencyMs: 120, httpStatus: 500, // bucket b1 (100–250ms)
    });

    const day = await readDay(db);
    expect(day.statusByProvider.openai).toEqual({ ok: 1, errors: 1, upstream_error: 1 });
    expect(day.latencyBuckets.openai).toEqual({ b4: 1, b1: 1 });
    // Base aggregation untouched
    expect(day.requests).toBe(2);
    expect(day.byProvider.openai.requests).toBe(2);
  });

  it("pre-telemetry writes leave the rollup fields absent (fail-open)", async () => {
    const { db, repo } = await bootRepo();
    await repo.saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const day = await readDay(db);
    expect(day.statusByProvider.openai).toEqual({ ok: 1 }); // statusClass derived even uninstrumented
    expect(day.latencyBuckets).toBeUndefined(); // no latency → no bucket
  });
});

describe("W1-B — dedupe interaction", () => {
  it("telemetry rides the first INSERT; a duplicate group adds no row", async () => {
    const { db, repo } = await bootRepo();
    const base = {
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      timestamp: "2026-08-14T10:00:00.000Z",
    };
    await repo.saveRequestUsage({ ...base, latencyMs: 500, httpStatus: 200 });
    await repo.saveRequestUsage({ ...base, latencyMs: 999, httpStatus: 500 }); // same identity

    const rows = db.all(`SELECT latencyMs, httpStatus, statusClass FROM usageHistory`);
    expect(rows.length).toBe(1);
    expect(rows[0].latencyMs).toBe(500); // first write wins, never retrofit
    expect(rows[0].statusClass).toBe("ok");
  });
});
