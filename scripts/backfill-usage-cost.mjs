#!/usr/bin/env node
/**
 * ⛵ Vela — usage-cost backfill (the pricing shadow) [2026-08-16]
 *
 * Cost is frozen into usageHistory at WRITE time. Rows written before a model
 * had a price entry carry cost=0 forever. This script recomputes cost=0 rows
 * against the CURRENT pricing chain and rebuilds the affected usageDaily
 * rollups — so the harbor's ledger tells the truth again.
 *
 * Usage:
 *   node scripts/backfill-usage-cost.mjs                 # DRY RUN (default)
 *   node scripts/backfill-usage-cost.mjs --apply         # write the fix
 *   node scripts/backfill-usage-cost.mjs --db <path>     # explicit DB file
 *   node scripts/backfill-usage-cost.mjs --provider qoder
 *
 * Default DB path follows src/lib/dataDir.js: $DATA_DIR, else
 * %APPDATA%/vela (Windows) or ~/.vela (unix), + /db/data.sqlite.
 *
 * Safety: dry-run by default; --apply opens read-write and wraps every
 * mutation in ONE transaction. If the live gateway holds the DB locked,
 * stop it first (docker compose stop vela-gateway) and re-run.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes("--apply");
const ONLY_PROVIDER = flag("--provider");

// ---------- pricing engine (the same chain the gateway uses) ----------
const pricing = await import("../open-sse/providers/pricing.js");
const { getPricingForModel, calculateCostFromTokens } = pricing;

// ---------- DB path resolution (mirrors src/lib/dataDir.js) ----------
function defaultDbPath() {
  const APP_NAME = "vela";
  let dir;
  if (process.env.DATA_DIR) {
    dir = process.env.DATA_DIR;
  } else if (process.platform === "win32") {
    dir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  } else {
    dir = path.join(os.homedir(), `.${APP_NAME}`);
  }
  return path.join(dir, "db", "data.sqlite");
}
const dbPath = flag("--db") || defaultDbPath();
if (!fs.existsSync(dbPath)) {
  console.error(`✗ DB not found: ${dbPath}\n  Pass --db <path> to point at the right data.sqlite.`);
  process.exit(1);
}
console.log(`⛵ Vela cost backfill — ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`   DB: ${dbPath}`);

// ---------- driver ----------
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(dbPath, { readOnly: !APPLY });

// ---------- helpers (faithful copies of usageRepo internals) ----------
function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {}; day.byModel ||= {}; day.byAccount ||= {}; day.byApiKey ||= {}; day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);
  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  if (entry.connectionId) addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  const apiKeyVal = entry.keyId && typeof entry.keyId === "string" ? entry.keyId : "local-no-key";
  addToCounter(day.byApiKey, `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, keyId: entry.keyId || null, keyPrefix: entry.keyPrefix || null } });
  const endpoint = entry.endpoint || "Unknown";
  addToCounter(day.byEndpoint, `${endpoint}|${entry.model}|${entry.provider || "unknown"}`, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

// ---------- phase 1: find re-priceable zero-cost rows ----------
// Schema-adaptive: pre-governance DBs lack keyId/keyPrefix columns.
const cols = db.prepare(`PRAGMA table_info(usageHistory)`).all().map((c) => c.name);
const has = (c) => cols.includes(c);
const pick = ["id", "timestamp", "provider", "model", "connectionId", "endpoint", "tokens"];
if (has("keyId")) pick.push("keyId");
if (has("keyPrefix")) pick.push("keyPrefix");

const where = ["(cost = 0 OR cost IS NULL)", "tokens IS NOT NULL", "tokens != ''"];
const params = [];
if (ONLY_PROVIDER) { where.push("provider = ?"); params.push(ONLY_PROVIDER); }
const zeroRows = db.prepare(
  `SELECT ${pick.join(", ")} FROM usageHistory WHERE ${where.join(" AND ")}`
).all(...params);

const updates = [];           // { id, cost, dateKey }
const touchedDays = new Set();
const byModel = new Map();    // "provider/model" → { rows, priced, total }
let newTotalCost = 0;

for (const row of zeroRows) {
  const key = `${row.provider || "?"}/${row.model || "?"}`;
  const stat = byModel.get(key) || { rows: 0, priced: 0, total: 0 };
  stat.rows++;
  const tokens = parseJson(row.tokens, {});
  const p = getPricingForModel(row.provider || "", row.model || "");
  if (p) {
    const cost = calculateCostFromTokens(tokens, p);
    if (cost > 0) {
      stat.priced++; stat.total += cost; newTotalCost += cost;
      updates.push({ id: row.id, cost, dateKey: getLocalDateKey(row.timestamp) });
      touchedDays.add(getLocalDateKey(row.timestamp));
    }
  }
  byModel.set(key, stat);
}

console.log(`\n📊 Zero-cost rows scanned: ${zeroRows.length}`);
console.log(`   Re-priceable: ${updates.length} rows across ${touchedDays.size} days`);
console.log(`   Recovered est. cost: $${newTotalCost.toFixed(2)}\n`);
console.log("   provider/model                rows   priced   recovered");
for (const [key, s] of [...byModel.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  if (s.priced === 0 && s.rows < 50) continue;
  console.log(`   ${key.padEnd(40)} ${String(s.rows).padEnd(6)} ${String(s.priced).padEnd(8)} $${s.total.toFixed(2)}`);
}

if (!APPLY) {
  console.log(`\n✓ Dry run complete — nothing written. Re-run with --apply to seal the fix.`);
  process.exit(0);
}

// ---------- phase 2: apply (one transaction) ----------
const upd = db.prepare(`UPDATE usageHistory SET cost = ? WHERE id = ?`);
const upsertDay = db.prepare(
  `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`
);
const selectDayRows = db.prepare(
  `SELECT timestamp, provider, model, connectionId, ${has("keyId") ? "keyId, keyPrefix," : ""} endpoint, cost, tokens
   FROM usageHistory WHERE timestamp >= ? AND timestamp < ?`
);

const applyAll = () => {
  db.exec("BEGIN");
  try {
    for (const u of updates) upd.run(u.cost, u.id);

    for (const dateKey of touchedDays) {
      // Rebuild the whole day from usageHistory — local-TZ day window
      const [y, mo, da] = dateKey.split("-").map(Number);
      const start = new Date(y, mo - 1, da, 0, 0, 0, 0);
      const end = new Date(y, mo - 1, da + 1, 0, 0, 0, 0);
      const dayRows = selectDayRows.all(start.toISOString(), end.toISOString());
      const day = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {} };
      for (const r of dayRows) {
        aggregateEntryToDay(day, { ...r, tokens: parseJson(r.tokens, {}) });
      }
      upsertDay.run(dateKey, JSON.stringify(day));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
applyAll();
console.log(`\n✅ Applied — ${updates.length} rows re-priced, ${touchedDays.size} daily rollups rebuilt.`);
console.log(`   If the MariaDB twin is live under mirror, its usage watermark resync picks the change up.`);
