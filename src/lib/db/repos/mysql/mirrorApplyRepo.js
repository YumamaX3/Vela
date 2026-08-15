// Storage Covenant Wave C3 — the pump's twin-side apply layer.
//
// The plan's law: "applies through the mysql repo impls the parity tests
// prove." Identity-carrying ops cannot ride the repo creators (createCombo
// MINTS a uuid, createApiKey MINTS a key — replay would poison the twin's
// UNIQUE constraints), so this layer mirrors the twin repos' merge/dedupe/
// reorder semantics with the CAPTURED identity inserted directly:
//
//   • idempotent-upsert + rmw-stale-hazard → dispatch to the same mysql repo
//     writers the parity harness proves, INSIDE one transaction that also
//     writes the seq-dedupe row (at-least-once delivery deduped at apply).
//   • identity-carrying → direct upsert carrying the sqlite-generated
//     identity (uuid + timestamps) from the outbox row.
//
// Census ratchet honored: this file lives under repos/mysql/ and reaches the
// twin only through getMysqlAdapter().
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";
import { validateKeyLimits } from "../../keyLimits.js";
import { sanitizeCategory } from "./apiKeysRepo.js";

/** The mysql twin's apply-cursor table (sqlite side: mirrorSeq, migration
 *  007). One row per applied outbox seq — INSERT IGNORE makes re-delivery a
 *  no-op INSIDE the same transaction as the mutation. Bootstrap never creates
 *  it (mirrorSeq is not in TABLES — the twin's own ledger is twin-only state);
 *  the pump ensures it before the first apply. */
export function mirrorSeqTableDdl() {
  return `CREATE TABLE IF NOT EXISTS mirrorSeq (seq BIGINT PRIMARY KEY)`;
}

export async function ensureMirrorSeqTable(db = null) {
  const d = db ?? (await getMysqlAdapter());
  await d.exec(mirrorSeqTableDdl());
}

// ─── Identity-carrying replay (captured identity, never minted) ──────────

async function replayCreateCombo(tx, op) {
  // A redacted row may only be REDELIVERY-proofed — the captured identity can
  // never be trusted to rebuild content without the args (the pump sends it
  // only so the seq-dedupe guard can answer "already applied").
  if (op.redacted) return "poison";
  const [data = {}] = op.args;
  const id = op.identity?.id;
  if (!id) return "poison"; // identity lost (crash window / S3 age-out)
  const models = stringifyJson(data.models ?? []);
  await tx.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), kind=VALUES(kind), models=VALUES(models), updatedAt=VALUES(updatedAt)`,
    [id, data.name, data.kind ?? null, models, op.identity.createdAt, op.identity.updatedAt]
  );
  return "applied";
}

async function replayCreateProviderConnection(tx, op) {
  if (op.redacted) return "poison"; // see replayCreateCombo — redelivery only
  const [data = {}] = op.args;
  const id = op.identity?.id;
  if (!id) return "poison";
  const { provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = data;
  await tx.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       provider=VALUES(provider), authType=VALUES(authType), name=VALUES(name),
       email=VALUES(email), priority=VALUES(priority), isActive=VALUES(isActive),
       data=VALUES(data), updatedAt=VALUES(updatedAt)`,
    [
      id, provider, authType ?? "oauth", name ?? null, email ?? null,
      priority ?? null, isActive === false ? 0 : 1, stringifyJson(rest),
      op.identity.createdAt, op.identity.updatedAt,
    ]
  );
  await reorderProvider(tx, provider);
  return "applied";
}

async function replayCreateProviderNode(tx, op) {
  if (op.redacted) return "poison"; // see replayCreateCombo — redelivery only
  const [data = {}] = op.args;
  const id = op.identity?.id;
  if (!id) return "poison";
  const { type, name, createdAt, updatedAt, ...rest } = data;
  await tx.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE type=VALUES(type), name=VALUES(name), data=VALUES(data), updatedAt=VALUES(updatedAt)`,
    [id, type ?? null, name ?? null, stringifyJson(rest), op.identity.createdAt, op.identity.updatedAt]
  );
  return "applied";
}

async function replayCreateProxyPool(tx, op) {
  if (op.redacted) return "poison"; // see replayCreateCombo — redelivery only
  const [data = {}] = op.args;
  const id = op.identity?.id;
  if (!id) return "poison";
  const { isActive, testStatus, createdAt, updatedAt, ...rest } = data;
  await tx.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE isActive=VALUES(isActive), testStatus=VALUES(testStatus), data=VALUES(data), updatedAt=VALUES(updatedAt)`,
    [id, isActive === false ? 0 : 1, testStatus ?? null, stringifyJson(rest),
     op.identity.createdAt, op.identity.updatedAt ?? op.identity.createdAt]
  );
  return "applied";
}

// S3: replay never carries the plaintext key or the keyId — the captured
// keyHash/keyPrefix/createdAt ride the outbox identity column instead. The
// id is a deterministic replay-local derivation (the twin's own row key);
// resolveKey() resolves by keyHash, so the gate reads the same key.
async function replayCreateApiKey(tx, op) {
  if (op.redacted) return "poison"; // see replayCreateCombo — redelivery only
  const [name, opts = {}] = op.args;
  const id = `mirror:${op.identity?.keyHash ?? op.seq}`;
  const limits = validateKeyLimits(opts ?? {});
  if (!limits.ok) return "poison"; // invalid governance can never replay
  const v = limits.values;
  const category = sanitizeCategory(opts?.category);
  await tx.run(
    `INSERT INTO apiKeys(id, \`key\`, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, isInternal, rateLimitRpm, tokenBudgetDaily, spendCapDailyCents, budgetScope, expiresAt, ipAllowlist, category)
     VALUES(?, ?, ?, NULL, 1, ?, 'v1', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), keyPrefix=VALUES(keyPrefix)`,
    [
      id,
      `vela-minted-${id}`,
      name ?? null,
      op.identity?.createdAt,
      op.identity?.keyHash ?? null,
      op.identity?.keyPrefix ?? null,
      opts?.description || null,
      opts?.allowedModels != null ? JSON.stringify(opts.allowedModels) : null,
      v.rateLimitRpm ?? null,
      v.tokenBudgetDaily ?? null,
      v.spendCapDailyCents ?? null,
      v.budgetScope ?? null,
      v.expiresAt ?? null,
      v.ipAllowlist != null ? JSON.stringify(v.ipAllowlist) : null,
      category,
    ]
  );
  return "applied";
}

// ensureInternalKey is DETERMINISTIC under a shared API_KEY_SECRET: replay
// re-executes the twin's own creator (identity null by design — capturing
// keyId would violate S3).
async function replayEnsureInternalKey(tx, op) {
  if (op.redacted) return "poison"; // see replayCreateCombo — redelivery only
  const [purpose] = op.args;
  if (!purpose) return "poison";
  const name = `internal:${purpose}`;
  const existing = await tx.get(`SELECT * FROM apiKeys WHERE name = ? AND isInternal = 1`, [name]);
  const { deriveInternalKey } = await import("@/shared/utils/apiKey");
  const derived = deriveInternalKey(purpose);
  if (existing) {
    if (existing.keyHash !== derived.keyHash) {
      await tx.run(`UPDATE apiKeys SET keyHash = ?, keyPrefix = ? WHERE id = ?`, [derived.keyHash, derived.keyPrefix, existing.id]);
    }
    return "applied";
  }
  const createdAt = op.identity?.createdAt || new Date().toISOString();
  await tx.run(
    `INSERT INTO apiKeys(id, \`key\`, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, allowedModels, isInternal, ipAllowlist)
     VALUES(?, ?, ?, NULL, 1, ?, 'v1', ?, ?, NULL, 1, NULL)`,
    [derived.keyId, `vela-internal-${purpose}`, name, createdAt, derived.keyHash, derived.keyPrefix]
  );
  return "applied";
}

const IDENTITY_REPLAYS = {
  createCombo: replayCreateCombo,
  createProviderConnection: replayCreateProviderConnection,
  createProviderNode: replayCreateProviderNode,
  createProxyPool: replayCreateProxyPool,
  createApiKey: replayCreateApiKey,
  ensureInternalKey: replayEnsureInternalKey,
};

// ─── idempotent-upsert + rmw-stale-hazard: dispatch to the twin repos ────
// The writers run INSIDE the pump's transaction (their own db.transaction()
// reuses the same pooled connection — nested transactions ride the outer
// one, so the seq-dedupe row commits atomically with the mutation).

const LAZY = {
  combos: null, connections: null, nodes: null, pools: null,
  apiKeys: null, settings: null, alias: null, pricing: null, disabled: null,
};
async function repos() {
  if (!LAZY.combos) {
    [LAZY.combos, LAZY.connections, LAZY.nodes, LAZY.pools, LAZY.apiKeys,
     LAZY.settings, LAZY.alias, LAZY.pricing, LAZY.disabled] = await Promise.all([
      import("./combosRepo.js"), import("./connectionsRepo.js"), import("./nodesRepo.js"),
      import("./proxyPoolsRepo.js"), import("./apiKeysRepo.js"), import("./settingsRepo.js"),
      import("./aliasRepo.js"), import("./pricingRepo.js"), import("./disabledModelsRepo.js"),
    ]);
  }
  return LAZY;
}

async function dispatchRepoWriter(fnName, args, redacted) {
  // A redacted rmw/upsert row cannot rebuild the mutation — redelivery only.
  if (redacted) return "poison";
  const r = await repos();
  const SURFACE = {
    ...r.combos, ...r.connections, ...r.nodes, ...r.pools,
    ...r.apiKeys, ...r.settings, ...r.alias, ...r.pricing, ...r.disabled,
    touchKeyLastUsed: (await import("./usageRepo.js")).touchKeyLastUsed,
  };
  const fn = SURFACE[fnName];
  if (typeof fn !== "function") return "poison"; // registry/parity drift guard
  await fn(...args);
  return "applied";
}

/** Apply one outbox row to the mysql twin. Returns "applied" | "poison".
 *  At-least-once delivery is deduped at apply: the seq-dedupe row rides the
 *  SAME transaction as the mutation (INSERT IGNORE), so a redelivered row
 *  leaves the twin untouched. */
export async function applyOutboxRow(op) {
  const db = await getMysqlAdapter();
  await ensureMirrorSeqTable(db);
  return db.transaction(async (tx) => {
    const already = await tx.get(`SELECT seq FROM mirrorSeq WHERE seq = ?`, [op.seq]);
    if (already) return "applied"; // double delivery — the dedupe row stands

    let verdict;
    switch (op.replayClass) {
      case "idempotent-upsert":
      case "rmw-stale-hazard":
        verdict = await dispatchRepoWriter(op.fnName, op.args, op.redacted);
        break;
      case "identity-carrying": {
        const replay = IDENTITY_REPLAYS[op.fnName];
        verdict = replay ? await replay(tx, op) : "poison";
        break;
      }
      default:
        verdict = "poison"; // exempt rows never reach apply (the pump skips)
    }

    // The dedupe row commits ONLY when the apply committed — a failed apply
    // leaves no seq marker, so the retry re-applies (the mutation itself is
    // upsert-ordered, so re-application converges).
    if (verdict === "applied") {
      await tx.run(`INSERT IGNORE INTO mirrorSeq(seq) VALUES(?)`, [op.seq]);
    }
    return verdict;
  });
}

// ─── Helpers mirroring the twin repos' internals ──────────────────────────

async function reorderProvider(tx, providerId) {
  const rows = await tx.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId]);
  const list = rows.map((row) => {
    const extra = parseJson(row.data, {});
    return { id: row.id, priority: row.priority, updatedAt: row.updatedAt, ...extra };
  });
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  for (let i = 0; i < list.length; i++) {
    await tx.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, list[i].id]);
  }
}
