// Test covenant: combos-fleet-api — the four routes the combos deck reads and
// writes (stats · export · bulk · import), driven against a REAL migrated DB.
//
// These are producer-side guards the page's own suite cannot give: that suite
// injects literal props, so none of it would fail if these routes stopped
// answering. Each case asserts what a client observes — the census arithmetic,
// the file an export hands over, one verdict per bulk item, and the promise the
// import route exists for: a dry run writes nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-combos-api-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "combos-fleet-api-secret";
  delete global._dbAdapter;
  // driver.js captures `state = global._dbAdapter` at module load, so the
  // registry must be reset or the next import binds the previous test's handle.
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

const BASE = "http://localhost/api/combos";

function get(pathname) {
  return new Request(`${BASE}${pathname}`);
}

function post(pathname, body) {
  return new Request(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function routes() {
  const [stats, exportRoute, bulk, importRoute, localDb] = await Promise.all([
    import("@/app/api/combos/stats/route.js"),
    import("@/app/api/combos/export/route.js"),
    import("@/app/api/combos/bulk/route.js"),
    import("@/app/api/combos/import/route.js"),
    import("@/lib/localDb"),
  ]);
  return { stats, exportRoute, bulk, importRoute, localDb };
}

async function loadDb() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

function insertUsage(db, { combo, prompt = 10, completion = 5, statusClass = "ok", cost = 0.001, agoMs = 0 }) {
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens, cost, status, statusClass, combo) VALUES(?, 'openai', 'gpt-5', '', '', ?, ?, ?, 'ok', ?, ?)`,
    [new Date(Date.now() - agoMs).toISOString(), prompt, completion, cost, statusClass, combo]
  );
}

describe("GET /api/combos/stats — the fleet census", { timeout: 20000 }, () => {
  it("counts only llm combos, but reports every kind in the table", async () => {
    const { stats, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude", "openai/gpt-5"], kind: "llm" });
    await localDb.createCombo({ name: "vela/cc/sonnet", models: ["anthropic/claude"], kind: null });
    await localDb.createCombo({ name: "solo", models: [], kind: "llm" });
    await localDb.createCombo({ name: "vela/search", models: ["tavily/tavily"], kind: "webSearch" });

    const body = await (await stats.GET(get("/stats?hours=24&top=5"))).json();

    expect(body.totals.combos).toBe(3);
    expect(body.totals.combosAllKinds).toBe(4);
    expect(body.totals.members).toBe(3);
    expect(body.totals.uniqueModels).toBe(2);
    expect(body.totals.providers).toBe(2);
    expect(body.totals.emptyCombos).toBe(1);
    // No connection is configured in this harbor, so every member with a
    // provider segment is honestly reported unreachable.
    expect(body.totals.unreachableMembers).toBe(3);
    expect(body.totals.activeCombos).toBe(0);
    expect(body.totals.idleCombos).toBe(3);

    expect(body.byStrategy).toEqual({ fallback: 3, "round-robin": 0, fusion: 0 });
    expect(body.harbors).toEqual([
      { harbor: "", combos: 1, members: 0 },
      { harbor: "vela/cc", combos: 2, members: 3 },
    ]);

    const solo = body.attention.find((a) => a.name === "solo");
    expect(solo.reasons).toContain("no members");
    const opus = body.attention.find((a) => a.name === "vela/cc/opus");
    expect(opus.reasons.join(" ")).toContain("2 member providers offline");
    // No usage row exists yet, so the whole fleet is honestly idle.
    expect(body.idle).toEqual(["vela/cc/opus", "vela/cc/sonnet", "solo"]);
  });

  it("routes usage to the right combo, reads the strategy mix from settings, and lets no direct row in", async () => {
    const { stats, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude"], kind: "llm" });
    await localDb.createCombo({ name: "vela/cc/sonnet", models: ["anthropic/claude"], kind: "llm" });
    await localDb.updateSettings({ comboStrategies: { "vela/cc/opus": { fallbackStrategy: "fusion" } } });

    const db = await loadDb();
    insertUsage(db, { combo: "vela/cc/opus", agoMs: 3000 });
    insertUsage(db, { combo: "vela/cc/opus", agoMs: 2000 });
    insertUsage(db, { combo: "vela/cc/opus", agoMs: 1000 });
    insertUsage(db, { combo: "vela/cc/sonnet" });
    insertUsage(db, { combo: null, prompt: 999, completion: 999 });

    const body = await (await stats.GET(get("/stats?hours=24&top=5"))).json();

    expect(body.totals.activeCombos).toBe(2);
    expect(body.totals.idleCombos).toBe(0);
    expect(body.totals.fusionCombos).toBe(1);
    expect(body.byStrategy.fusion).toBe(1);
    expect(body.top.map((t) => t.name)).toEqual(["vela/cc/opus", "vela/cc/sonnet"]);
    expect(body.top[0]).toMatchObject({ requests: 3, tokens: 45, strategy: "fusion" });
    expect(body.top[1]).toMatchObject({ requests: 1, tokens: 15, strategy: "fallback" });
    // The three opus rows + one sonnet row. The direct row (999 tokens) is not
    // in any combo's arithmetic.
    expect(body.top.reduce((sum, t) => sum + t.tokens, 0)).toBe(60);
  });
});

describe("GET /api/combos/export — the fleet as one file", { timeout: 20000 }, () => {
  it("carries the llm fleet by default, adds the rest on scope=all, and ships strategies only for exported names", async () => {
    const { exportRoute, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude", "openai/gpt-5"], kind: "llm" });
    await localDb.createCombo({ name: "vela/search", models: ["tavily/tavily"], kind: "webSearch" });
    await localDb.updateSettings({
      comboStrategies: {
        "vela/cc/opus": { fallbackStrategy: "round-robin" },
        "vela/search": { fallbackStrategy: "fusion" },
      },
    });

    const response = await exportRoute.GET(get("/export"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="vela-combos-\d{4}-\d{2}-\d{2}\.json"$/
    );

    const llm = JSON.parse(await response.text());
    expect(llm.format).toBe("vela-combos");
    expect(llm.version).toBe(1);
    expect(llm.scope).toBe("llm");
    expect(llm).toHaveProperty("exportedAt");
    expect(llm.combos.map((c) => c.name)).toEqual(["vela/cc/opus"]);
    expect(llm.combos[0].models).toEqual(["anthropic/claude", "openai/gpt-5"]);
    // A strategy about a combo that did not ride along is a setting about nothing.
    expect(llm.strategies).toEqual({ "vela/cc/opus": { fallbackStrategy: "round-robin" } });

    const all = JSON.parse(await (await exportRoute.GET(get("/export?scope=all"))).text());
    expect(all.scope).toBe("all");
    expect(all.combos.map((c) => c.name).sort()).toEqual(["vela/cc/opus", "vela/search"]);
    expect(all.strategies["vela/search"]).toEqual({ fallbackStrategy: "fusion" });
  });
});

describe("POST /api/combos/bulk — one verdict per item", { timeout: 20000 }, () => {
  it("mints a -copy name for every selected combo, and leaves the originals untouched", async () => {
    const { bulk, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude"], kind: "llm" });
    await localDb.createCombo({ name: "vela/cc/sonnet", models: ["anthropic/claude"], kind: "llm" });

    const body = await (
      await bulk.POST(post("/bulk", { action: "duplicate", names: ["vela/cc/opus", "vela/cc/sonnet"] }))
    ).json();

    expect(body.action).toBe("duplicate");
    expect(body.changed).toBe(2);
    expect(body.results).toEqual([
      { name: "vela/cc/opus", ok: true, newName: "vela/cc/opus-copy" },
      { name: "vela/cc/sonnet", ok: true, newName: "vela/cc/sonnet-copy" },
    ]);
    const names = (await localDb.getCombos()).map((c) => c.name).sort();
    expect(names).toEqual(["vela/cc/opus", "vela/cc/opus-copy", "vela/cc/sonnet", "vela/cc/sonnet-copy"]);
  });

  it("reports a partial rewrite as exactly that: an outsider and a collision both fail by name", async () => {
    const { bulk, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude"], kind: "llm" });
    await localDb.createCombo({ name: "other/sonnet", models: ["anthropic/claude"], kind: "llm" });
    await localDb.createCombo({ name: "vela/claude/opus", models: ["openai/gpt-5"], kind: "llm" });

    const body = await (
      await bulk.POST(
        post("/bulk", {
          action: "renameNamespace",
          names: ["vela/cc/opus", "other/sonnet"],
          prefix: "vela/cc",
          nextPrefix: "vela/claude",
        })
      )
    ).json();

    expect(body.changed).toBe(0);
    expect(body.results).toEqual([
      { name: "vela/cc/opus", ok: false, error: '"vela/claude/opus" already exists' },
      { name: "other/sonnet", ok: false, error: "Not under vela/cc/" },
    ]);
    // Nothing moved: the collision was refused, not silently dropped.
    const names = (await localDb.getCombos()).map((c) => c.name).sort();
    expect(names).toEqual(["other/sonnet", "vela/cc/opus", "vela/claude/opus"]);
  });

  it("refuses an unknown action, an empty selection, and a strategy rewrite with nothing to set", async () => {
    const { bulk, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude"], kind: "llm" });

    const unknown = await bulk.POST(post("/bulk", { action: "torpedo", ids: ["x"] }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain("torpedo");

    const empty = await bulk.POST(post("/bulk", { action: "delete" }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe("Nothing selected");

    const nothingToSet = await bulk.POST(post("/bulk", { action: "setStrategy", names: ["vela/cc/opus"] }));
    expect(nothingToSet.status).toBe(400);
    expect((await nothingToSet.json()).error).toContain("Nothing to set");
    expect((await localDb.getSettings()).comboStrategies ?? {}).toEqual({});
  });
});

describe("POST /api/combos/import — the dry run is the point", { timeout: 20000 }, () => {
  const payload = () => ({
    combos: [
      { name: "vela/cc/new", models: ["openai/gpt-5"] },
      { name: "vela/cc/opus", models: ["openai/gpt-6"] },
      { name: "bad name", models: ["openai/gpt-5"] },
    ],
    strategies: {
      "vela/cc/new": { fallbackStrategy: "round-robin" },
      "vela/cc/opus": { fallbackStrategy: "fusion" },
    },
  });

  it("judges the whole file and writes nothing until apply is asked for", async () => {
    const { importRoute, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude"], kind: "llm" });

    const dry = await (
      await importRoute.POST(post("/import", { payload: payload(), mode: "dry-run", onConflict: "overwrite" }))
    ).json();

    expect(dry.mode).toBe("dry-run");
    expect(dry.summary).toEqual({ incoming: 3, add: 1, overwrite: 1, skip: 0, invalid: 1 });
    expect(dry.invalid).toEqual([
      { name: "bad name", error: "Name can only contain letters, numbers, -, _, . and /" },
    ]);
    expect(dry.plan.map((p) => p.action)).toEqual(["add", "overwrite"]);
    expect(dry.applied).toBeNull();

    // The route's whole reason to exist: nothing landed, and no strategy rode along.
    expect((await localDb.getCombos()).length).toBe(1);
    expect((await localDb.getCombos())[0].models).toEqual(["anthropic/claude"]);
    expect((await localDb.getSettings()).comboStrategies ?? {}).toEqual({});
  });

  it("lands exactly the plan on apply, and overwrites rather than duplicating", async () => {
    const { importRoute, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude"], kind: "llm" });

    const applied = await (
      await importRoute.POST(post("/import", { payload: payload(), mode: "apply", onConflict: "overwrite" }))
    ).json();

    expect(applied.applied.changed).toBe(2);
    expect(applied.applied.strategies).toBe(2);
    expect(applied.applied.results).toEqual([
      { name: "vela/cc/new", ok: true, action: "add" },
      { name: "vela/cc/opus", ok: true, action: "overwrite" },
    ]);

    const combos = await localDb.getCombos();
    expect(combos.map((c) => c.name).sort()).toEqual(["vela/cc/new", "vela/cc/opus"]);
    expect(combos.find((c) => c.name === "vela/cc/opus").models).toEqual(["openai/gpt-6"]);
    const strategies = (await localDb.getSettings()).comboStrategies;
    expect(strategies["vela/cc/opus"]).toEqual({ fallbackStrategy: "fusion" });
    expect(strategies["vela/cc/new"]).toEqual({ fallbackStrategy: "round-robin" });
  });

  it("onConflict=skip leaves the existing combo's fleet alone", async () => {
    const { importRoute, localDb } = await routes();
    await localDb.createCombo({ name: "vela/cc/opus", models: ["anthropic/claude"], kind: "llm" });

    const out = await (
      await importRoute.POST(post("/import", { payload: payload(), mode: "apply", onConflict: "skip" }))
    ).json();

    expect(out.summary).toEqual({ incoming: 3, add: 1, overwrite: 0, skip: 1, invalid: 1 });
    expect(out.applied.changed).toBe(1);
    expect(out.applied.results).toEqual([
      { name: "vela/cc/new", ok: true, action: "add" },
      { name: "vela/cc/opus", ok: false, error: "already exists" },
    ]);
    const combos = await localDb.getCombos();
    expect(combos.find((c) => c.name === "vela/cc/opus").models).toEqual(["anthropic/claude"]);
    // The skipped combo's strategy was not written about a fleet that never moved.
    expect((await localDb.getSettings()).comboStrategies["vela/cc/opus"]).toBeUndefined();
  });
});
