// Storage Covenant Wave A7 — the config-wave PARITY GATE.
// Plan: plans/storage-covenant.md A7 exit gate ("parity green"): settings,
// connections, nodes, proxyPools, combos, alias (+mysql/kv.js) proven equal
// across the sqlite harbor and the mysql twin against a REAL MariaDB
// (opt-in VELA_TEST_MYSQL_URL, LOUD skip banner).
//
// Method: the SAME deterministic scenario runs blind in both harbors — every
// one of the wave's 38 symbols is exercised — then the two resulting worlds
// are normalized (A4 volatile-field contract: strip generated uuids and
// wall-clock timestamps, never the data) and compared canonically. A
// divergence fails loudly; identity proves the twins are one contract.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, vi } from "vitest";
import { VOLATILE_BY_TABLE } from "./harness/runner.js";

const MYSQL_URL = process.env.VELA_TEST_MYSQL_URL;
if (!MYSQL_URL) {
  console.warn("[A7 SKIP LOUD] VELA_TEST_MYSQL_URL unset — config-wave parity vs real MariaDB skipped (no silent coverage)");
}

let tempDirs = [];
const saved = {};
for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL"]) saved[k] = process.env[k];

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vela-a7-"));
  tempDirs.push(d);
  return d;
}

afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  try { await global._mysqlAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.resetModules();
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

/** Canonical JSON — recursively sort object keys so key-order never fakes a divergence. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}

/** Strip volatile/generated fields per the A4 normalization contract. */
function stripRows(rows, table) {
  const fields = VOLATILE_BY_TABLE[table] || [];
  return rows.map((r) => {
    const c = { ...r };
    for (const f of fields) delete c[f];
    return c;
  });
}
const stripRow = (r, table) => (r ? stripRows([r], table)[0] : null);

/** One deterministic scenario — exercises ALL 38 config-wave symbols. */
async function configScenario(api) {
  // settingsRepo (6)
  await api.updateSettings({ requireApiKey: true, comboStrategy: "fallback", counter: 7 });
  // connectionsRepo (8)
  const c1 = await api.createProviderConnection({
    provider: "openai", authType: "apikey", name: "Parity Conn A", apiKey: "k-a", priority: 1, isActive: true,
  });
  await api.createProviderConnection({
    provider: "anthropic", authType: "oauth", email: "parity@shores.eternal", accessToken: "at", refreshToken: "rt",
  });
  const solo = await api.createProviderConnection({ provider: "parity-solo", authType: "apikey", name: "Solo", apiKey: "k-s" });
  await api.createProviderConnection({ provider: "parity-doomed", authType: "apikey", name: "Doomed", apiKey: "k-d" });
  await api.updateProviderConnection(c1.id, { name: "Parity Conn A2" });
  await api.reorderProviderConnections("openai");
  await api.deleteProviderConnection(solo.id);
  const doomedDeleted = await api.deleteProviderConnectionsByProvider("parity-doomed");
  await api.cleanupProviderConnections();
  const conns = await api.getProviderConnections();
  const connById = await api.getProviderConnectionById(c1.id);
  // nodesRepo (5)
  await api.createProviderNode({ id: "parity-node-1", type: "worker", name: "PN", region: "local" });
  await api.createProviderNode({ id: "parity-node-2", type: "worker", name: "PN2", region: "local" });
  await api.updateProviderNode("parity-node-1", { name: "PN-renamed" });
  await api.deleteProviderNode("parity-node-2");
  const nodes = await api.getProviderNodes();
  const nodeById = await api.getProviderNodeById("parity-node-1");
  // proxyPoolsRepo (5)
  await api.createProxyPool({ id: "parity-pool-1", name: "PP", proxyUrl: "socks5://parity", proxies: [] });
  await api.createProxyPool({ id: "parity-pool-2", name: "PP2", proxyUrl: "socks5://parity2", proxies: [] });
  await api.updateProxyPool("parity-pool-1", { name: "PP-renamed" });
  await api.deleteProxyPool("parity-pool-2");
  const pools = await api.getProxyPools();
  const poolById = await api.getProxyPoolById("parity-pool-1");
  // combosRepo (6)
  const combo1 = await api.createCombo({ name: "Parity Combo", kind: "fallback", models: ["openai/gpt-4o"] });
  const combo2 = await api.createCombo({ name: "Parity Combo 2", kind: "round-robin", models: ["a/b"] });
  await api.updateCombo(combo1.id, { models: ["openai/gpt-4o", "openai/gpt-4o-mini"] });
  await api.deleteCombo(combo2.id);
  const combos = await api.getCombos();
  const comboByName = await api.getComboByName("Parity Combo");
  const comboById = await api.getComboById(combo1.id);
  // aliasRepo (8)
  await api.setModelAlias("gpt-fast", "openai/gpt-4o");
  await api.setModelAlias("parity-del", "x/y");
  await api.deleteModelAlias("parity-del");
  const aliases = await api.getModelAliases();
  const add1 = await api.addCustomModel({ providerAlias: "parity", id: "cm-1", type: "llm", name: "CM1" });
  const addDup = await api.addCustomModel({ providerAlias: "parity", id: "cm-1", type: "llm", name: "CM1-dup" });
  await api.addCustomModel({ providerAlias: "parity", id: "cm-2", type: "llm", name: "CM2" });
  await api.deleteCustomModel({ providerAlias: "parity", id: "cm-2", type: "llm" });
  const customs = await api.getCustomModels();
  await api.setMitmAliasAll("tool-a", { m1: "t1" });
  await api.setMitmAliasAll("tool-b", {});
  const mitmOne = await api.getMitmAlias("tool-a");
  const mitmAll = await api.getMitmAlias();

  return {
    // settings
    settings: await api.getSettings(),
    exported: await api.exportSettings(),
    cloud: await api.isCloudEnabled(),
    cloudUrl: await api.getCloudUrl(),
    merged: api.mergeWithDefaults({ customKey: 1 }),
    // connections
    doomedDeleted,
    connections: stripRows(conns, "providerConnections")
      .sort((a, b) => `${a.provider}|${a.name || ""}`.localeCompare(`${b.provider}|${b.name || ""}`)),
    connById: stripRow(connById, "providerConnections"),
    // nodes
    nodes: stripRows(nodes, "providerNodes").sort((a, b) => String(a.id).localeCompare(String(b.id))),
    nodeById: stripRow(nodeById, "providerNodes"),
    // pools
    pools: stripRows(pools, "proxyPools").sort((a, b) => String(a.id).localeCompare(String(b.id))),
    poolById: stripRow(poolById, "proxyPools"),
    // combos
    combos: stripRows(combos, "combos").sort((a, b) => String(a.name).localeCompare(String(b.name))),
    comboByName: stripRow(comboByName, "combos"),
    comboById: stripRow(comboById, "combos"),
    // aliases
    aliases,
    add1, addDup,
    customs: canon(customs).sort((a, b) => `${a.providerAlias}|${a.id}`.localeCompare(`${b.providerAlias}|${b.id}`)),
    mitmOne, mitmAll,
  };
}

async function buildSqliteWorld() {
  process.env.DATA_DIR = freshDir();
  process.env.VELA_DB_MODE = "sqlite";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
  const api = {
    ...(await import("@/lib/db/repos/sqlite/settingsRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/connectionsRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/nodesRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/proxyPoolsRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/combosRepo.js")),
    ...(await import("@/lib/db/repos/sqlite/aliasRepo.js")),
  };
  return configScenario(api);
}

async function buildMysqlWorld() {
  process.env.VELA_MYSQL_URL = MYSQL_URL;
  delete global._mysqlAdapter;
  vi.resetModules();
  const { getMysqlAdapter } = await import("@/lib/db/mysql/adapter.js");
  const db = await getMysqlAdapter(); // boots pool + bootstrap (additive, idempotent)
  // Clean the config tables so the scenario seeds a deterministic world.
  await db.exec("DELETE FROM providerConnections");
  await db.exec("DELETE FROM providerNodes");
  await db.exec("DELETE FROM proxyPools");
  await db.exec("DELETE FROM combos");
  await db.exec("DELETE FROM settings");
  await db.exec("DELETE FROM kv WHERE scope IN ('modelAliases','customModels','mitmAlias')");
  const api = {
    ...(await import("@/lib/db/repos/mysql/settingsRepo.js")),
    ...(await import("@/lib/db/repos/mysql/connectionsRepo.js")),
    ...(await import("@/lib/db/repos/mysql/nodesRepo.js")),
    ...(await import("@/lib/db/repos/mysql/proxyPoolsRepo.js")),
    ...(await import("@/lib/db/repos/mysql/combosRepo.js")),
    ...(await import("@/lib/db/repos/mysql/aliasRepo.js")),
  };
  return configScenario(api);
}

describe.skipIf(!MYSQL_URL)("Storage Covenant A7 — config-wave parity vs real MariaDB", () => {
  it("sqlite harbor ≡ mysql twin — all 38 config symbols converge", async () => {
    const sqliteWorld = await buildSqliteWorld();
    const mysqlWorld = await buildMysqlWorld();

    const keys = Object.keys(sqliteWorld);
    expect(keys.length).toBeGreaterThanOrEqual(20); // the world is non-trivial
    for (const k of keys) {
      expect(
        JSON.stringify(canon(mysqlWorld[k])),
        `divergent world key: ${k}`
      ).toBe(JSON.stringify(canon(sqliteWorld[k])));
    }

    // Spot-checks that prove the comparison guards real content
    expect(sqliteWorld.connections.length).toBe(2);          // solo + doomed removed
    expect(sqliteWorld.doomedDeleted).toBe(1);
    expect(sqliteWorld.add1).toBe(true);                     // first add wins
    expect(sqliteWorld.addDup).toBe(false);                  // duplicate race refused
    expect(sqliteWorld.customs.length).toBe(1);              // cm-2 deleted
    expect(sqliteWorld.aliases).toEqual({ "gpt-fast": "openai/gpt-4o" });
    expect(sqliteWorld.combos.length).toBe(1);
    expect(sqliteWorld.settings.counter).toBe(7);
    expect(sqliteWorld.exported).toEqual({ requireApiKey: true, comboStrategy: "fallback", counter: 7 });
  }, 30000);

  it("the FACADE seam dispatches to the mysql twin under VELA_DB_MODE=mysql", async () => {
    // The parity test above drives the twins directly. THIS leg proves the
    // bindFacade seam: with VELA_DB_MODE=mysql, importing the FACADES (the
    // path-stable barrel entries consumers use) routes every config-wave call
    // into repos/mysql/* — not sqlite. A broken seam would read/write the
    // sqlite harbor and diverge from the twin's world.
    process.env.DATA_DIR = freshDir();
    process.env.VELA_DB_MODE = "mysql";
    process.env.VELA_MYSQL_URL = MYSQL_URL;
    delete global._mysqlAdapter;
    vi.resetModules();

    const settings = await import("@/lib/db/repos/settingsRepo.js");
    const combos = await import("@/lib/db/repos/combosRepo.js");
    const aliases = await import("@/lib/db/repos/aliasRepo.js");

    // Reads must hit the mysql twin (the parity world left data there)
    const s = await settings.getSettings();
    expect(s.counter).toBe(7);                          // seeded by buildMysqlWorld above
    const comboList = await combos.getCombos();
    expect(comboList.some((c) => c.name === "Parity Combo")).toBe(true);
    const al = await aliases.getModelAliases();
    expect(al["gpt-fast"]).toBe("openai/gpt-4o");

    // A write through the facade must land in the mysql twin, verifiable
    await aliases.setModelAlias("facade-seam-probe", "probe/target");
    const after = await aliases.getModelAliases();
    expect(after["facade-seam-probe"]).toBe("probe/target");
    await aliases.deleteModelAlias("facade-seam-probe");
  }, 30000);
});
