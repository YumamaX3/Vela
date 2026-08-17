// Usage Observatory W4-C — request tags contract test.
//
// Covers, against a real sqlite twin (route handlers invoked directly — the
// tags route rides the "/api/usage" prefix guard at the edge, so route-level
// tests pin the handler contract, not the middleware):
//   • the pure validation contract (requestTagDef.js) — ≤64, charset
//     allow-list, ≤8 tags, case-insensitive dedupe, trimming
//   • migration 010 forged the table + registry/schema mirror advanced to 10
//   • the repo twins' round-trip, REPLACE semantics, and batch lookup
//   • PUT /api/usage/metrics/ledger/tags — 200 stored set, honest 400s
//   • ledger rows carry their tags (one bounded IN query per page)
//   • the CSV export gains a formula-guarded "tags" column
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w4c-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w4c-secret";
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
  const db = await getAdapter();
  return db;
}

async function seedUsageRow(now) {
  const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
  await saveRequestUsage({
    provider: "openai",
    model: "gpt-4o",
    status: "ok",
    latencyMs: 180,
    httpStatus: 200,
    tokens: { prompt_tokens: 100, completion_tokens: 40 },
    cost: 0.004,
    timestamp: new Date(now).toISOString(),
  });
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  return db.get(`SELECT id FROM usageHistory ORDER BY id DESC LIMIT 1`).id;
}

function putReq(body) {
  return new Request("http://localhost/api/usage/metrics/ledger/tags", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("W4-C request tags — the pure validation contract", () => {
  it("accepts the full allow-list: letters, digits, space and _ - . / :", async () => {
    const { validateTagName, validateTagSet } = await import("@/lib/requestTagDef.js");
    for (const good of ["prod", "retry 2", "team/relay", "night-job", "v1.2", "edge:canary", "A1"]) {
      expect(validateTagName(good)).toBeNull();
    }
    const set = validateTagSet(["prod", "team/relay"]);
    expect(set.errors).toEqual([]);
    expect(set.tags).toEqual(["prod", "team/relay"]);
  });

  it("rejects empty, overlong, foreign-charset, and non-string tags", async () => {
    const { validateTagName } = await import("@/lib/requestTagDef.js");
    expect(validateTagName("")).toMatch(/empty/);
    expect(validateTagName("   ")).toMatch(/empty/);
    expect(validateTagName("a".repeat(65))).toMatch(/at most 64/);
    expect(validateTagName("a,b")).toMatch(/only letters/); // comma breaks CSV
    expect(validateTagName('a"b')).toMatch(/only letters/); // quote breaks CSV
    expect(validateTagName("a<b>")).toMatch(/only letters/); // HTML breaks render
    expect(validateTagName("_lead")).toMatch(/only letters/); // must start alnum
    expect(validateTagName(42)).toMatch(/string/);
  });

  it("boundary edges pass: exactly 64 chars, exactly 8 tags", async () => {
    const { validateTagName, validateTagSet } = await import("@/lib/requestTagDef.js");
    expect(validateTagName("a".repeat(64))).toBeNull();
    const eight = Array.from({ length: 8 }, (_, i) => `tag${i}`);
    expect(validateTagSet(eight).errors).toEqual([]);
  });

  it("the set contract: dedupe case-insensitively, trim, cap at 8, refuse non-arrays", async () => {
    const { validateTagSet } = await import("@/lib/requestTagDef.js");
    expect(validateTagSet("nope").errors.length).toBeGreaterThan(0);
    expect(validateTagSet(Array.from({ length: 9 }, (_, i) => `t${i}`)).errors.length).toBeGreaterThan(0);
    const deduped = validateTagSet(["Prod", " prod ", "PROD", "retry"]);
    expect(deduped.errors).toEqual([]);
    expect(deduped.tags).toEqual(["Prod", "retry"]); // first casing wins, trimmed
  });
});

describe("W4-C request tags — migration 010 + schema mirror", () => {
  it("migration registry and schema mirror advanced to 10", async () => {
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    expect(latestVersion()).toBe(10);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const { TABLES, SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    expect(SCHEMA_VERSION).toBe(10);
    expect(TABLES.usageRequestTags).toBeTruthy();
    expect(TABLES.usageRequestTags.columns.name).toBe("TEXT NOT NULL");
    expect(TABLES.usageRequestTags.columns.usageId).toBe("INTEGER NOT NULL");
  });

  it("the table + both indexes exist after boot (migration chain applied)", async () => {
    const db = await boot();
    const table = db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='usageRequestTags'`);
    expect(table?.name).toBe("usageRequestTags");
    const idx = db.all(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='usageRequestTags'`).map((r) => r.name);
    expect(idx).toContain("idx_urt_usageId");
    expect(idx).toContain("uq_urt_usageId_name");
  });
});

describe("W4-C request tags — the repo contract", () => {
  it("round-trips a set and REPLACES it (no duplicates, order preserved)", async () => {
    await boot();
    const id = await seedUsageRow(Date.now());
    const repo = await import("@/lib/db/repos/sqlite/usageTagsRepo.js");

    expect(await repo.getUsageTags(id)).toEqual([]);
    await repo.setUsageTags(id, ["prod", "team/relay"]);
    expect(await repo.getUsageTags(id)).toEqual(["prod", "team/relay"]);

    await repo.setUsageTags(id, ["retry"]);
    expect(await repo.getUsageTags(id)).toEqual(["retry"]); // replaced, not appended

    await repo.setUsageTags(id, []);
    expect(await repo.getUsageTags(id)).toEqual([]); // an empty set clears
  });

  it("getTagsForUsageIds batches one page into a Map and filters garbage", async () => {
    await boot();
    const now = Date.now();
    const id1 = await seedUsageRow(now);
    const id2 = await seedUsageRow(now - 60_000);
    const repo = await import("@/lib/db/repos/sqlite/usageTagsRepo.js");
    await repo.setUsageTags(id1, ["a", "b"]);
    await repo.setUsageTags(id2, ["c"]);

    const map = await repo.getTagsForUsageIds([id1, id2, 0, -3, "junk", null]);
    expect(map.get(id1)).toEqual(["a", "b"]);
    expect(map.get(id2)).toEqual(["c"]);
    expect(map.size).toBe(2); // garbage ids never reach the query

    expect(await repo.getTagsForUsageIds([])).toEqual(new Map()); // no bare IN ()
  });
});

describe("W4-C request tags — PUT /api/usage/metrics/ledger/tags", () => {
  it("stores the set and echoes the server-truth back (200)", async () => {
    await boot();
    const id = await seedUsageRow(Date.now());
    const { PUT } = await import("@/app/api/usage/metrics/ledger/tags/route.js");
    const res = await PUT(putReq({ id, tags: ["Prod", " prod ", "retry"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.tags).toEqual(["Prod", "retry"]); // deduped + trimmed server-side
  });

  it("refuses malformed JSON with 400, never a 500", async () => {
    await boot();
    const { PUT } = await import("@/app/api/usage/metrics/ledger/tags/route.js");
    const res = await PUT(putReq("{not-json"));
    expect(res.status).toBe(400);
  });

  it("refuses a bad id: missing, zero, non-numeric", async () => {
    await boot();
    const { PUT } = await import("@/app/api/usage/metrics/ledger/tags/route.js");
    for (const bad of [{ tags: ["x"] }, { id: 0, tags: ["x"] }, { id: "abc", tags: ["x"] }]) {
      const res = await PUT(putReq(bad));
      expect(res.status).toBe(400);
    }
  });

  it("refuses a bad tag set with 400 + the honest error list", async () => {
    await boot();
    const id = await seedUsageRow(Date.now());
    const { PUT } = await import("@/app/api/usage/metrics/ledger/tags/route.js");

    const notArray = await PUT(putReq({ id, tags: "prod" }));
    expect(notArray.status).toBe(400);

    const tooMany = await PUT(putReq({ id, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }));
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).maxTags).toBe(8);

    const badCharset = await PUT(putReq({ id, tags: ["ok", 'a"b'] }));
    expect(badCharset.status).toBe(400);
    const out = await badCharset.json();
    expect(Array.isArray(out.errors)).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
  });
});

describe("W4-C request tags — ledger + export carry the tags", () => {
  it("ledger rows carry their tags; untagged rows stay an honest []", async () => {
    await boot();
    const now = Date.now();
    const taggedId = await seedUsageRow(now);
    const bareId = await seedUsageRow(now - 60_000);
    const { PUT } = await import("@/app/api/usage/metrics/ledger/tags/route.js");
    const put = await PUT(putReq({ id: taggedId, tags: ["prod", "night-job"] }));
    expect(put.status).toBe(200);

    const { GET } = await import("@/app/api/usage/metrics/ledger/route.js");
    const res = await GET(new Request("http://localhost/api/usage/metrics/ledger?period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const tagged = body.items.find((r) => r.id === taggedId);
    const bare = body.items.find((r) => r.id === bareId);
    expect(tagged.tags).toEqual(["prod", "night-job"]);
    expect(bare.tags).toEqual([]);
  });

  it("the CSV export gains a quoted, comma-space joined tags column", async () => {
    await boot();
    const now = Date.now();
    const id = await seedUsageRow(now);
    const { PUT } = await import("@/app/api/usage/metrics/ledger/tags/route.js");
    // Valid tags start alphanumeric (allow-list), so a tag cell can never
    // open a formula — csvCell's tab-pad stays defense-in-depth here, and
    // the allow-list keeps commas/quotes out of every tag, so the ", " join
    // inside the quoted cell is unambiguous.
    const put = await PUT(putReq({ id, tags: ["ledger", "prod"] }));
    expect(put.status).toBe(200);

    const { GET } = await import("@/app/api/usage/metrics/export/route.js");
    const res = await GET(new Request("http://localhost/api/usage/metrics/export?period=24h"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    const header = csv.split("\n")[0];
    expect(header).toContain('"tags"');
    // The tag cell: quoted, comma-space joined, oldest first.
    expect(csv).toContain('"ledger, prod"');
  });
});
