// Test covenant: usagehistory-reqid — the log pipeline's join keys on the
// usage ledger, and the dedupe identity that must NOT move because of them.
// (log-pipeline plan, milestone M2)
//
// WHY THIS SUITE IS SEPARATE from log-events-migration-018: that suite proves
// the new table landed. It cannot, by itself, catch the failure this wave's
// real risk lives in — a usageHistory dedupe identity quietly widened. A test
// asserting only "reqId exists" passes just as cheerfully against a UNIQUE
// index that now includes reqId, and that version double-counts.
//
// THE LAW: uq_uh_dedupe is a claim that two rows are the same usage EVENT.
// A request id is not part of that claim. This gateway genuinely retries —
// a second real upstream call that produces real tokens and real cost — and
// folding reqId into the identity would give that retry a second row where the
// ledger expects one, silently inflating every total the dashboard reports.
//
// That is not a hypothetical. It is precisely the shape migration 015 had to
// step around when it added `combo` to the same table (schema.js records that
// combo is "never part of a uq_uh_dedupe identity" for the same reason), and
// it is why the index is asserted by its EXACT column list rather than by its
// name: a name survives a definition that no longer says what it means.
//
// The round-trip cases exist because a column can exist and still not be
// writable through the real adapter — the portable-surface contract under test
// is run/get/all/exec, and a value that never survives the write is a column
// the join path cannot use.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

async function bootNative() {
  delete global._dbAdapter;
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

// The identity as it stood before this migration, and as it must stand after.
// Seven columns, in this order, and no eighth.
const DEDUPE_COLUMNS = [
  "timestamp", "provider", "model", "connectionId",
  "keyId", "promptTokens", "completionTokens",
];

beforeEach(() => {
  // The DB-harness trap: paths.js freezes DATA_DIR at first import and
  // driver.js binds global._dbAdapter at module eval. BOTH hooks bust the
  // module cache so a later test never writes into an earlier test's dir.
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-uh-reqid-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "uh-reqid-test-secret";
  delete global._dbAdapter;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

function insertUsage(db, { reqId, upstreamId, timestamp, prompt = 10, completion = 5 }) {
  db.run(
    `INSERT INTO usageHistory
       (timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens, cost, status, reqId, upstreamId)
     VALUES (?, 'openai', 'gpt-5', 'conn-1', 'key-1', ?, ?, 0.01, 'ok', ?, ?)`,
    [timestamp, prompt, completion, reqId, upstreamId]
  );
}

describe("usageHistory — the log pipeline's join keys (migration 018)", () => {
  it("a usage row carrying reqId + upstreamId reads back by reqId", async () => {
    const db = await bootNative();
    insertUsage(db, {
      reqId: "req-abc",
      upstreamId: "up-1",
      timestamp: new Date().toISOString(),
    });

    const row = db.get(
      `SELECT id, reqId, upstreamId, provider, promptTokens FROM usageHistory WHERE reqId = ?`,
      ["req-abc"]
    );
    expect(row.reqId).toBe("req-abc");
    expect(row.upstreamId).toBe("up-1");
    expect(row.promptTokens).toBe(10);
  });

  it("both ids survive NULL — pre-instrumentation rows claim nothing", async () => {
    const db = await bootNative();
    insertUsage(db, { reqId: null, upstreamId: null, timestamp: new Date().toISOString() });

    const row = db.get(`SELECT reqId, upstreamId FROM usageHistory`);
    // NULL, not "". These columns are not in the dedupe identity, so NULL is
    // both honest ("no instrumentation was there") and engine-safe — and a
    // NOT NULL '' would assert an id that never existed.
    expect(row.reqId).toBeNull();
    expect(row.upstreamId).toBeNull();
  });

  it("one request threads several upstream calls, each addressable by its own id", async () => {
    const db = await bootNative();
    const base = Date.now();
    // A fallback request: hop 1 fails, hop 2 answers. One reqId, two
    // upstreamIds — which is precisely why upstreamId exists separately.
    insertUsage(db, { reqId: "req-xyz", upstreamId: "up-1", timestamp: new Date(base).toISOString(), prompt: 3, completion: 1 });
    insertUsage(db, { reqId: "req-xyz", upstreamId: "up-2", timestamp: new Date(base + 1).toISOString(), prompt: 7, completion: 4 });

    const byReq = db.all(`SELECT upstreamId FROM usageHistory WHERE reqId = ? ORDER BY id ASC`, ["req-xyz"]);
    expect(byReq.map((r) => r.upstreamId)).toEqual(["up-1", "up-2"]);

    const byUp = db.all(`SELECT reqId FROM usageHistory WHERE upstreamId = ?`, ["up-2"]);
    expect(byUp).toHaveLength(1);
    expect(byUp[0].reqId).toBe("req-xyz");
  });

  it("THE LOAD-BEARING LAW — uq_uh_dedupe still names exactly seven columns", async () => {
    const db = await bootNative();

    // Asserted by column list, not by index name: a name survives a
    // definition that no longer means what it says.
    const rows = db.all(`PRAGMA index_list(usageHistory)`);
    const dedupe = rows.find((r) => r.name === "uq_uh_dedupe");
    expect(dedupe, "uq_uh_dedupe must exist").toBeTruthy();
    expect(dedupe.unique).toBe(1);

    const cols = db.all(`PRAGMA index_info(uq_uh_dedupe)`).map((c) => c.name);
    expect(cols).toEqual(DEDUPE_COLUMNS);
    // Spelled out so the intent survives a reader who never saw the comment:
    // a request id is not part of "same usage event".
    expect(cols).not.toContain("reqId");
    expect(cols).not.toContain("upstreamId");
  });

  it("two rows differing ONLY in reqId still collide — reqId is outside the identity", async () => {
    const db = await bootNative();
    const ts = new Date().toISOString();

    // Byte-identical across all seven identity columns; the ONLY difference is
    // the request id. This must be refused — and it is refused precisely
    // BECAUSE reqId is not part of the identity: if reqId were in it, these
    // would be two distinct rows and the insert would succeed. The collision
    // is the proof, read in the right direction.
    insertUsage(db, { reqId: "req-a", upstreamId: "up-1", timestamp: ts, prompt: 10, completion: 5 });
    let collision = null;
    try {
      insertUsage(db, { reqId: "req-b", upstreamId: "up-1", timestamp: ts, prompt: 10, completion: 5 });
    } catch (e) {
      collision = e;
    }
    expect(collision, "an identical usage event must be refused regardless of reqId").toBeTruthy();

    // The engine's own message is the second proof, and it is quoted rather
    // than asserted on loosely: the violated constraint names the seven
    // columns and does NOT name reqId or upstreamId. This is the dedupe
    // identity holding its shape under a migration that added two columns to
    // the very table it guards.
    const message = String(collision?.message || "");
    for (const col of DEDUPE_COLUMNS) expect(message).toContain(col);
    expect(message).not.toContain("reqId");
    expect(message).not.toContain("upstreamId");
    expect(db.get(`SELECT COUNT(*) AS n FROM usageHistory`).n).toBe(1);
  });

  it("a genuine retry — a distinct event — is still recorded, so cost is never lost", async () => {
    const db = await bootNative();
    const base = Date.now();

    // Hop 1 then hop 2: two real upstream calls a moment apart, each with its
    // own tokens and its own upstreamId. The gateway really does retry, and a
    // retry is real spend. Dedupe must collapse the SAME event without
    // collapsing this — the two failure directions are different bugs, and
    // this one (vanishing cost) is the more expensive of the pair.
    insertUsage(db, { reqId: "req-xyz", upstreamId: "up-1", timestamp: new Date(base).toISOString(), prompt: 10, completion: 5 });
    insertUsage(db, { reqId: "req-xyz", upstreamId: "up-2", timestamp: new Date(base + 40).toISOString(), prompt: 10, completion: 5 });

    expect(db.get(`SELECT COUNT(*) AS n FROM usageHistory`).n).toBe(2);
    const hops = db.all(`SELECT upstreamId FROM usageHistory WHERE reqId = ? ORDER BY id ASC`, ["req-xyz"]);
    expect(hops.map((h) => h.upstreamId)).toEqual(["up-1", "up-2"]);
  });
});