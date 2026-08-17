// Usage Observatory W1 — migration 008 (usage telemetry) + status map.
// Proves: columns/indexes land on fresh + upgraded DBs, the batched
// statusClass backfill classifies legacy rows honestly (and idempotently),
// and src/lib/usageStatus.js derives classes without inventing signals.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-m008-"));
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

const NEW_COLUMNS = ["latencyMs", "ttftMs", "httpStatus", "statusClass"];
const NEW_INDEXES = ["idx_uh_ts_provider", "idx_uh_ts_keyId", "idx_uh_ts_status", "idx_uh_ts_latency"];

function insertLegacyRow(db, { status, statusClass = null, ts }) {
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens, cost, status, statusClass, tokens, meta)
     VALUES(?, ?, ?, '', '', 10, 20, 0, ?, ?, '{}', '{}')`,
    [ts || new Date().toISOString(), "openai", "gpt-4o", status, statusClass]
  );
}

describe("Migration 008 — usage telemetry", () => {
  it("fresh DB gains telemetry columns + composite indexes", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const cols = db.all(`PRAGMA table_info(usageHistory)`).map((r) => r.name);
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);

    const idx = db.all(`PRAGMA index_list(usageHistory)`).map((i) => i.name);
    for (const i of NEW_INDEXES) expect(idx).toContain(i);
  });

  it("upgraded DB: backfill classifies legacy status rows honestly", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    // Seed legacy rows in every observed status shape (statusClass NULL =
    // pre-migration reality).
    insertLegacyRow(db, { status: "ok", ts: "2026-08-01T00:00:00.000Z" });
    insertLegacyRow(db, { status: "success", ts: "2026-08-02T00:00:00.000Z" });
    insertLegacyRow(db, { status: "error", ts: "2026-08-03T00:00:00.000Z" });
    insertLegacyRow(db, { status: null, ts: "2026-08-04T00:00:00.000Z" });

    // Force re-run from v7 (simulate an upgraded harbor).
    db.run(`UPDATE _meta SET value = '7' WHERE key = 'schemaVersion'`);
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();

    const rows = db2.all(`SELECT status, statusClass FROM usageHistory ORDER BY timestamp`);
    expect(rows.map((r) => r.statusClass)).toEqual(["ok", "ok", "upstream_error", ""]);

    const stamped = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(stamped.value, 10)).toBe(10);
  });

  it("backfill is idempotent and never touches classified rows", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    insertLegacyRow(db, { status: "error", ts: "2026-08-01T00:00:00.000Z" });
    insertLegacyRow(db, { status: "error", statusClass: "rate_limited", ts: "2026-08-02T00:00:00.000Z" }); // instrumented row wins
    db.run(`UPDATE _meta SET value = '7' WHERE key = 'schemaVersion'`);
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();

    // Re-run again (second upgrade pass) — nothing may change.
    db2.run(`UPDATE _meta SET value = '7' WHERE key = 'schemaVersion'`);
    db2.close?.();
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter3 } = await import("@/lib/db/driver.js");
    const db3 = await getAdapter3();

    const rows = db3.all(`SELECT status, statusClass FROM usageHistory ORDER BY timestamp`);
    expect(rows.map((r) => r.statusClass)).toEqual(["upstream_error", "rate_limited"]);
  });

  it("auto-sync heals dropped Observatory indexes", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_uh_ts_latency`);
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(usageHistory)`).map((i) => i.name);
    expect(idx).toContain("idx_uh_ts_latency");
  });
});

describe("usageStatus — the classification covenant", () => {
  it("classifies legacy status strings without inventing signals", async () => {
    const { classifyLegacyStatus } = await import("@/lib/usageStatus.js");
    expect(classifyLegacyStatus("ok")).toBe("ok");
    expect(classifyLegacyStatus("success")).toBe("ok");
    expect(classifyLegacyStatus("error")).toBe("upstream_error");
    expect(classifyLegacyStatus(null)).toBe("");
    expect(classifyLegacyStatus("")).toBe("");
    expect(classifyLegacyStatus("something-new")).toBe(""); // never invent
  });

  it("classifies httpStatus into the sealed taxonomy", async () => {
    const { classifyHttpStatus } = await import("@/lib/usageStatus.js");
    expect(classifyHttpStatus(200)).toBe("ok");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    expect(classifyHttpStatus(408)).toBe("timeout");
    expect(classifyHttpStatus(499)).toBe("timeout");
    expect(classifyHttpStatus(504)).toBe("timeout");
    expect(classifyHttpStatus(404)).toBe("client_error");
    expect(classifyHttpStatus(500)).toBe("upstream_error");
    expect(classifyHttpStatus(null)).toBe(null); // no signal → null, not ''
    expect(classifyHttpStatus(0)).toBe(null);
  });

  it("deriveStatusClass: httpStatus wins, legacy falls back, fail-open never throws", async () => {
    const { deriveStatusClass } = await import("@/lib/usageStatus.js");
    expect(deriveStatusClass({ status: "error", httpStatus: 429 })).toBe("rate_limited"); // instrumented wins
    expect(deriveStatusClass({ status: "error" })).toBe("upstream_error");
    expect(deriveStatusClass({ status: "ok" })).toBe("ok");
    expect(deriveStatusClass({})).toBe("");
    expect(deriveStatusClass(undefined)).toBe("");
  });
});
