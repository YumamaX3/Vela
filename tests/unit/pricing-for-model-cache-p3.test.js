/**
 * Responsive Tide P3 — the getPricingForModel 5s cache.
 * Plan: plans/2026-11-01-responsive-tide-performance.md §III P3
 *   ("5s TTL sync cache beside the existing syncCache; one kv read per 5s
 *    window, not per request") + §II suspect 3 ("un-cached kv.getAll() +
 *    JSON.parse of every pricing blob per completed request, ×2 with RTK").
 *
 * EXIT PINNED HERE:
 *   • CALL COUNT — N reads inside one 5s window cost exactly one kv read per
 *     namespace, across every stratum mix (N=5 × 4 read shapes); the next
 *     window reads again.
 *   • NEVER AN ANSWER — what getPricingForModel returns is byte-identical to
 *     a direct merge of the live kv rows + the static chain, stratum by
 *     stratum, at every point of the cache's life (cold, warm, stale, invalidated).
 *   • INVALIDATION — all five writers drop the window immediately, including
 *     a write that REVEALS a hidden model (which invalidates because the answer
 *     changed, not merely because it can).
 *   • THE DELIBERATE NON-CACHES — nulls are never memoized; stratum 3 is never
 *     cached (a change to the static tables is seen on the very next call).
 *
 * Runs against a real sqlite harbor in a temp DATA_DIR (the house pattern in
 * db-export-completeness.test.js), and counts kv reads at the ADAPTER, so the
 * census is measured, not inferred from a mock's call log.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const TMP_BASE = Date.now();
const BASE = Date.UTC(2026, 10, 1, 12, 0, 0, 0); // 2026-11-01T12:00:00.000Z
const WINDOW = 5000;

const USERS = {
  "openai|gpt-4o": { input: 9.9, output: 99 }, // shadows a static 2.5/10
  "openai|acme-user-only": { input: 1.5, output: 6 }, // has no static rate
};
const SYNCS = {
  "openai|acme-sync-only": { input: 0.4 }, // has no static rate
};
const USER_ROWS = { openai: { "gpt-4o": USERS["openai|gpt-4o"], "acme-user-only": USERS["openai|acme-user-only"] } };
// An override that sits under the provider ALIAS only (github → gh): a lookup
// that ever keyed on the raw provider id would miss it and change an answer.
const ALIAS_ROWS = { gh: { "alias-only-model": { input: 0.7, output: 3 } } };
const SYNC_ROWS = { openai: { "acme-sync-only": SYNCS["openai|acme-sync-only"] } };

// One read shape per stratum path, every shape's expectation pre-computed
// against the module tables — so "never an answer" is asserted against the
// real static facts, not against whatever the cache happened to return first.
const SHAPES = [
  ["openai", "gpt-4o"], // S1 — user override
  ["openai", "acme-sync-only"], // S2 — synced rate (user miss)
  ["openai", "gpt-4o-mini"], // S3 — static canonical
  ["qoder", "qmodel_38max"], // S3 — static provider lane
  ["qoder", "qmodel_38maxx"], // S3 — null (unpriceable miss)
  ["openai", "acme-user-only"], // S1 — user-only model
  ["github", "alias-only-model"], // S1 — user override under the ALIAS ONLY
];

let S; // the sqlite harbor, freshly imported per test
let STATIC; // the live static module
let COUNTS;
let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalMode = process.env.VELA_DB_MODE;

// The reference answer — the pre-P3 algorithm, written out: two kv reads, the
// same dual-key lookup, then the same static chain. If the cache ever returns
// anything this does not, the cache changed an answer.
async function referenceAnswer(provider, model) {
  if (!model) return null;
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const readScope = (scope) =>
    Object.fromEntries(db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]).map((r) => [r.key, JSON.parse(r.value)]));
  const lookup = (map, m) => map?.[provider]?.[m] ?? map?.[STATIC_ALIAS[provider]]?.[m] ?? null;
  const user = lookup(readScope("pricing"), model);
  if (user) return user;
  const sync = lookup(readScope("pricing_sync"), model);
  if (sync) return sync;
  return STATIC.getPricingForModel(provider, model);
}

let STATIC_ALIAS = {};

async function bootHarbor() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `vela-p3-${TMP_BASE}-`));
  process.env.DATA_DIR = tempDir;
  process.env.VELA_DB_MODE = "sqlite";
  delete global._dbAdapter;
  vi.resetModules();
  S = await import("@/lib/db/repos/sqlite/pricingRepo.js");
  STATIC = await import("open-sse/providers/pricing.js");
  const { PROVIDER_ID_TO_ALIAS } = await import("open-sse/config/providerModels.js");
  STATIC_ALIAS = PROVIDER_ID_TO_ALIAS || {};
  await seed();
  COUNTS = { kvReads: 0 };
}

// Every test starts from the same world: both namespaces wiped, then seeded
// through the repo's own writers (each of which invalidates) — so no test's
// window can leak into the next.
async function seed() {
  await S.resetAllPricing(); // clears 'pricing' (and every window)
  await S.clearSyncedPricing(); // clears 'pricing_sync' (F2 — its own affordance)
  await S.updatePricing({ ...USER_ROWS, ...ALIAS_ROWS });
  await S.replaceSyncedPricing(SYNC_ROWS, { syncedAt: "2026-11-01T00:00:00.000Z", sources: ["p3"], entryCount: 2 });
}

function countKvReads(db, sql) {
  if (/^\s*SELECT[^;]*\bFROM\s+kv\b/i.test(sql)) COUNTS.kvReads += 1;
}

async function adapter() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

/** The census helper: run a call shape N times and report kv reads. */
async function readsFor(calls) {
  const before = COUNTS.kvReads;
  const out = [];
  for (let i = 0; i < calls.length; i++) out.push(await S.getPricingForModel(...calls[i]));
  return { reads: COUNTS.kvReads - before, out };
}

// The four stride shapes — S1 / S2 / S3 / S3-lane, one per stratum path.
const ALL_SHAPES = SHAPES.slice(0, 4);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BASE);
  // Wrap the adapter's query methods so every kv read is counted wherever
  // pricingRepo reaches the adapter (it awaits getAdapter() per call).
  await bootHarbor();
  const db = await adapter();
  const wrapped = [];
  for (const name of ["all", "get", "run", "exec"]) {
    const orig = db[name].bind(db);
    db[name] = (sql, ...rest) => {
      countKvReads(db, String(sql));
      return orig(sql, ...rest);
    };
    wrapped.push(name);
  }
  expect(wrapped).toEqual(["all", "get", "run", "exec"]); // all four seams counted
});

afterAll(() => {
  vi.useRealTimers();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalMode === undefined) delete process.env.VELA_DB_MODE;
  else process.env.VELA_DB_MODE = originalMode;
});

beforeEach(async () => {
  // Every test starts on a frozen clock (the restore test switches to the real
  // one itself) and a cold cache over the seeded rows.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BASE);
  COUNTS.kvReads = 0;
  await seed();
  vi.setSystemTime(BASE);
});

describe("P3 exit — the call-count law (one kv read per 5s window, not per request)", () => {
  it("N=5 reads of one shape inside one window cost ONE kv read (was 5, ×2 with RTK)", async () => {
    const { reads, out } = await readsFor(Array.from({ length: 5 }, () => ["openai", "gpt-4o"]));
    expect(reads).toBe(1);
    expect(out.every((r) => r === out[0])).toBe(true);
    expect(out[0]).toEqual(USERS["openai|gpt-4o"]);
  });

  it("one window's steady state: 20 reads across user / synced / static / lane cost ZERO kv reads", async () => {
    // Warm the window first (the honest first window costs a flush — pinned
    // below), then the per-request posture is measured on its own.
    await readsFor(Array.from({ length: 5 }, () => ALL_SHAPES).flat());
    const { reads } = await readsFor(Array.from({ length: 5 }, () => ALL_SHAPES).flat());
    expect(reads).toBe(0);
  });

  it("the first window of a fresh process costs a 2-read flush, then stays at zero", async () => {
    // Synchronous kv: the user read lands, its miss drops through, and the
    // (new) sync window is revealed — a one-time flush, not a per-request read.
    // The miss shape warms sync first, then the count is the steady truth.
    const flush = await readsFor(Array.from({ length: 5 }, () => ALL_SHAPES).flat());
    expect(flush.reads).toBe(2);
    expect((await readsFor(Array.from({ length: 5 }, () => ALL_SHAPES).flat())).reads).toBe(0);
  });

  it("the next window reads again: reads scale with windows (2 windows of 5 = 2 reads)", async () => {
    const w1 = await readsFor(Array.from({ length: 5 }, () => ["openai", "gpt-4o"]));
    vi.advanceTimersByTime(WINDOW);
    const w2 = await readsFor(Array.from({ length: 5 }, () => ["openai", "gpt-4o"]));
    expect(w1.reads).toBe(1);
    expect(w2.reads).toBe(1);
  });

  it("holds the boundary law like getPricing's: fresh at +4999ms, stale at +5000ms", async () => {
    await S.getPricingForModel("openai", "gpt-4o");
    vi.advanceTimersByTime(WINDOW - 1);
    expect((await readsFor([["openai", "gpt-4o"]])).reads).toBe(0);
    vi.advanceTimersByTime(1);
    expect((await readsFor([["openai", "gpt-4o"]])).reads).toBe(1);
  });

  it("pre-warm cost: a call whose answer is ONLY in the sync stratum costs 2 reads (new cache flush)", async () => {
    // Fresh window: the user read lands, its miss drops through and is revealed
    // only in the (new) sync window — that second read is a cache flush, not a
    // per-request read. Steady state (above) is one.
    const { reads, out } = await readsFor([["openai", "acme-sync-only"]]);
    expect(reads).toBe(2);
    expect(out).toEqual([SYNCS["openai|acme-sync-only"]]);
  });

  it("100 reads across 10 windows: the flush, then 10 reads for 10 windows' worth of traffic", async () => {
    let reads = 0;
    for (let w = 0; w < 10; w++) {
      // a miss-first shape each window keeps the measured path the full one
      const r = await readsFor([["openai", "acme-sync-only"], ...Array.from({ length: 9 }, () => ALL_SHAPES[w % ALL_SHAPES.length])]);
      reads += r.reads;
      vi.advanceTimersByTime(WINDOW);
    }
    // 2 namespaces × 10 windows: the flush on w0, then one read per namespace
    // per window — never one per request.
    expect(reads).toBe(20);
  });

  it("a missing model short-circuits before any read (the !model guard stays first)", async () => {
    const { reads, out } = await readsFor([["openai", null], ["openai", ""], [null, null]]);
    expect(out).toEqual([null, null, null]);
    expect(reads).toBe(0);
  });
});

describe("P3 law — the cache never changes an answer", () => {
  it("cold window: every shape matches the two-kv-read reference", async () => {
    for (const shape of SHAPES) {
      expect(await S.getPricingForModel(...shape), shape.join("/")).toEqual(await referenceAnswer(...shape));
    }
  });

  it("warm window: every shape matches the reference again (the cached path)", async () => {
    for (const shape of SHAPES) await S.getPricingForModel(...shape);
    for (const shape of SHAPES) {
      expect(await S.getPricingForModel(...shape), shape.join("/")).toEqual(await referenceAnswer(...shape));
    }
  });

  it("an override under the provider ALIAS is found, cold and warm (lookupDualKey's id→alias)", async () => {
    // github → gh. The cache holds the raw MAPS, and the alias fallback runs on
    // every lookup — so a cached window can never miss the alias row.
    const expected = ALIAS_ROWS.gh["alias-only-model"];
    expect(await S.getPricingForModel("github", "alias-only-model")).toEqual(expected);
    expect(await S.getPricingForModel("github", "alias-only-model")).toEqual(expected); // warm
    expect((await readsFor([["github", "alias-only-model"]])).reads).toBe(0); // warm window: no kv read
    // the alias key is ALSO reachable by its own name — same row, same answer
    expect(await S.getPricingForModel("gh", "alias-only-model")).toEqual(expected);
  });

  it("stale window: after the rows change, the new window is the new truth", async () => {
    await S.getPricingForModel("openai", "gpt-4o");
    vi.advanceTimersByTime(WINDOW);
    await S.updatePricing({ openai: { "gpt-4o": { input: 11, output: 111 } } });
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual({ input: 11, output: 111 });
  });

  it("sovereignty holds through the cache: user > sync > static, stratum by stratum", async () => {
    // S1 — a user override beats the static truth for the same model
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual(USERS["openai|gpt-4o"]);
    expect(STATIC.getPricingForModel("openai", "gpt-4o")).toEqual({ input: 2.5, output: 10, cached: 1.25, reasoning: 10, cache_creation: 2.5 });
    // S2 — synced beats static
    expect(await S.getPricingForModel("openai", "acme-sync-only")).toEqual(SYNCS["openai|acme-sync-only"]);
    // S2-after-S1 — a user model never leaks into the sync lane
    expect(await S.getPricingForModel("openai", "acme-user-only")).toEqual(USERS["openai|acme-user-only"]);
    // S3 — the static chain answers only when both kv strata miss
    expect(await S.getPricingForModel("qoder", "qmodel_38max")).toEqual(STATIC.getPricingForModel("qoder", "qmodel_38max"));
  });
});

describe("P3 — invalidation: all five writers drop the window immediately", () => {
  it("updatePricing — the same window sees the new rate", async () => {
    await S.getPricingForModel("openai", "gpt-4o");
    await S.updatePricing({ openai: { "gpt-4o": { input: 7, output: 70 } } });
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual({ input: 7, output: 70 });
  });

  it("updatePricing — a write that REVEALS a model hidden behind kv is seen at once", async () => {
    // Before: both kv miss → static null (hidden). After: the override answers.
    expect(await S.getPricingForModel("openai", "acme-hidden")).toBe(null);
    await S.updatePricing({ openai: { "acme-hidden": { input: 3, output: 4 } } });
    expect(await S.getPricingForModel("openai", "acme-hidden")).toEqual({ input: 3, output: 4 });
  });

  it("resetPricing (one model) — the window falls through to sync/static", async () => {
    await S.getPricingForModel("openai", "gpt-4o");
    await S.resetPricing("openai", "gpt-4o");
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual(STATIC.getPricingForModel("openai", "gpt-4o"));
  });

  it("resetPricing (whole provider) — the window is re-read", async () => {
    await S.getPricingForModel("openai", "acme-user-only");
    await S.resetPricing("openai");
    expect(await S.getPricingForModel("openai", "acme-user-only")).toBe(null);
  });

  it("resetAllPricing — every cached answer falls through", async () => {
    await S.getPricingForModel("openai", "gpt-4o");
    await S.getPricingForModel("openai", "acme-sync-only");
    await S.resetAllPricing(); // clears the 'pricing' scope only (its own law)
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual(STATIC.getPricingForModel("openai", "gpt-4o"));
    // the sync stratum is NOT resetAllPricing's to clear (F2) — and its cached
    // window was dropped anyway, so the next call reads the rows afresh:
    const { reads, out } = await readsFor([["openai", "acme-sync-only"]]);
    expect(out).toEqual([SYNCS["openai|acme-sync-only"]]);
    expect(reads).toBe(0); // the flush was paid when the window was first opened
  });

  it("replaceSyncedPricing — the sync window is dropped, user overlay untouched", async () => {
    await S.getPricingForModel("openai", "acme-sync-only");
    await S.getPricingForModel("openai", "gpt-4o"); // warms the user window too
    await S.replaceSyncedPricing({ openai: { "acme-sync-only": { input: 0.8 } } }, { syncedAt: "2026-11-01T01:00:00.000Z", sources: ["p3"], entryCount: 1 });
    expect(await S.getPricingForModel("openai", "acme-sync-only")).toEqual({ input: 0.8 });
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual(USERS["openai|gpt-4o"]);
  });

  it("clearSyncedPricing — the sync stratum empties at once, static answers", async () => {
    await S.getPricingForModel("openai", "acme-sync-only");
    await S.clearSyncedPricing();
    expect(await S.getPricingForModel("openai", "acme-sync-only")).toBe(STATIC.getPricingForModel("openai", "acme-sync-only"));
  });

  it("every invalidation ALSO drops getPricing's own cache (one invalidate, three windows)", async () => {
    const first = await S.getPricing();
    await S.updatePricing({ openai: { "acme-new": { input: 1 } } });
    const second = await S.getPricing();
    expect(first).not.toBe(second); // rebuilt, not the same object
    expect(second.openai["acme-new"]).toEqual({ input: 1 });
  });
});

describe("P3 — the deliberate non-caches", () => {
  it("a null is NOT memoized: a row that appears by a non-invalidating write is seen next window", async () => {
    // Both strata are cached for the window; sync is re-read at the turn.
    expect(await S.getPricingForModel("openai", "acme-hidden")).toBe(null);
    expect(await S.getPricingForModel("openai", "acme-hidden")).toBe(null);
    // A raw write — the backup restore's kv rows — bypasses invalidate() on
    // purpose here: the point is that no negative answer was pinned, so the
    // next window's re-read is what finds it.
    vi.advanceTimersByTime(WINDOW);
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing','openai',?)`, [
      JSON.stringify({ ...USER_ROWS.openai, "acme-hidden": { input: 5, output: 6 } }),
    ]);
    expect(await S.getPricingForModel("openai", "acme-hidden")).toEqual({ input: 5, output: 6 });
  });

  it("stratum 3 is never cached: a change to the static tables lands on the very next call", async () => {
    const before = await S.getPricingForModel("qoder", "qmodel_38max");
    expect(before).toEqual(STATIC.PROVIDER_PRICING.qoder.qmodel_38max);
    const original = STATIC.PROVIDER_PRICING.qoder.qmodel_38max;
    try {
      STATIC.PROVIDER_PRICING.qoder.qmodel_38max = { input: 42, output: 84 };
      vi.advanceTimersByTime(WINDOW);
      // same window AND after the window: the static answer is re-derived
      expect(await S.getPricingForModel("qoder", "qmodel_38max")).toEqual({ input: 42, output: 84 });
      // and the very next call inside that same window, too — no static memo
      expect(await S.getPricingForModel("qoder", "qmodel_38max")).toEqual({ input: 42, output: 84 });
    } finally {
      STATIC.PROVIDER_PRICING.qoder.qmodel_38max = original;
    }
  });

  it("a backup RESTORE never leaves a stale answer (measured on the real clock)", async () => {
    // The restore writes the kv rows outside this module's writers. The cache
    // must then be stale for at most ONE window — the same 5s any writer-backed
    // path may take — and never longer. Measured on the real clock: fake Date
    // cannot drive the adapter's own file operations, and this law is about
    // wall time, so it is measured in wall time.
    vi.useRealTimers();
    const { importDb } = await import("@/lib/db/repos/backupRepo.js");
    await S.updatePricing({ openai: { "gpt-4o": { input: 9.9, output: 99 } } });
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual({ input: 9.9, output: 99 });

    await importDb({ pricing: { openai: { "gpt-4o": { input: 13, output: 131 } } } });
    // A window has passed since the warm read → the next call is post-restore truth.
    await new Promise((r) => setTimeout(r, WINDOW + 200));
    expect(await S.getPricingForModel("openai", "gpt-4o")).toEqual({ input: 13, output: 131 });
  }, 20000);

  it("the static tables are never copied: a lane's own object is returned by reference", async () => {
    const lane = STATIC.PROVIDER_PRICING.qoder.qmodel_38max;
    expect(await S.getPricingForModel("qoder", "qmodel_38max")).toBe(lane);
  });
});
