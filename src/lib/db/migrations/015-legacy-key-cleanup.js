// Legacy tombstone revival (v0.9.24) — the Star's choice: "why not just make
// from legacy into our latest vela database?" (Stillwater Mirror, Aug 2026).
//
// Migration 002 (apikey-governance) tombstoned every pre-governance key:
// plaintext OVERWRITTEN with 'revoked-<id>', keyHash NULLed, keyVersion
// 'legacy'. Those rows can never authenticate (a NULL hash matches no token).
// But the USER wants their keys back — so instead of deleting the tombstones,
// this migration REVIVES them: for each dead row, mint a brand-new working
// Vela key (fresh random secret + real hash, hash-at-rest covenant) carrying
// the same name/category. The fresh secrets are written once to a 0600
// pending-reveal file under DATA_DIR (same trust as api-key-secret) so the UI
// can surface them exactly once after the boot that applied this migration.
//
// The internal:model-test fossil is converted to a true internal row
// (isInternal = 1): ensureInternalKey("model-test") finds it and re-derives
// the deterministic hash on next use — no reveal needed there.
//
// SYNCHRONY COVENANT: the runner (migrate.js) calls m.up(adapter) inside a
// synchronous transaction and stamps schemaVersion immediately after — it
// NEVER awaits. An async up() would race the version stamp and orphan writes.
// Hence every mint here is direct synchronous SQL + node:crypto — no awaits,
// no repo imports. The INSERT mirrors apiKeysRepo.createApiKey's exact shape
// (hash-at-rest, v1, isInternal 0) so the row is indistinguishable from one
// the UI created.
//
// Mirror-safety: migrations run ONCE per boot on the primary adapter
// (driver.js); the mirror replays WRITERS via the outbox, never migrations —
// so minting here cannot diverge the twin. The outbox does not observe raw
// migration SQL (capture wraps repo writers only); the minted rows still
// arrive on the twin through the normal createApiKey path should the twin be
// rebuilt — and a NULL-hash legacy row on a twin is equally dead, so nothing
// is lost.
//
// Portable adapter surface ONLY — db.all/db.run/db.exec, no db.prepare
// (the v0.9.20 boot-storm lesson). Idempotent: a DB already at version 15
// (or with no legacy rows) is a no-op.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir.js";

const KEY_VERSION = "v1";

/** Deterministic HMAC CRC — must match shared/utils/apiKey.js exactly, else
 *  the gate's timing-safe pre-reject would kill a legitimately minted key. */
function computeCrc(keyId, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${KEY_VERSION}.${keyId}`)
    .digest("hex")
    .slice(0, 8);
}

function displayPrefix(keyId) {
  return `vela-${KEY_VERSION}-${keyId.slice(0, 4)}…`;
}

/** Synchronous mint — plaintext returned ONCE (never stored), hash at rest.
 *  Mirrors generateApiKey() from shared/utils/apiKey.js. */
function mintKey(secret) {
  const keyId = crypto.randomBytes(16).toString("hex");
  const key = `vela-${KEY_VERSION}-${keyId}-${computeCrc(keyId, secret)}`;
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  return { key, keyId, keyHash, keyPrefix: displayPrefix(keyId) };
}

function readSecret() {
  if (process.env.API_KEY_SECRET) return process.env.API_KEY_SECRET;
  try {
    return fs.readFileSync(path.join(DATA_DIR, "api-key-secret"), "utf8").trim();
  } catch {
    return null;
  }
}

/** Write the one-time reveal file. 0600 — the plaintext rides here ONCE,
 *  consumed by GET /api/keys/pending-reveals which deletes it after serving. */
function writePendingReveal(secrets) {
  if (!secrets.length) return;
  try {
    const file = path.join(DATA_DIR, "pending-key-reveals.json");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600, flag: "wx" });
    console.log(`[DB][migrate] #15 revived ${secrets.length} legacy key(s) — secrets in pending-reveal (0600)`);
  } catch (e) {
    // EEXIST = a previous boot already wrote (and possibly revealed) pending
    // secrets — never clobber an unrevealed secret.
    if (e.code !== "EEXIST") {
      console.warn(`[DB][migrate] #15 pending-reveal write failed (secrets lost — recreate manually): ${e.message}`);
    }
  }
}

export default {
  version: 15,
  name: "legacy-key-cleanup",
  up(db) {
    // 1. RESCUE the model-test fossil FIRST — convert to a true internal row.
    //    ensureInternalKey("model-test") finds it by name + isInternal = 1 and
    //    re-derives the deterministic hash on next use (rotation-follow in the
    //    repo refreshes keyHash/keyPrefix; this migration only fixes identity).
    db.exec(`
      UPDATE apiKeys
      SET isInternal = 1,
          name = 'internal:model-test',
          isActive = 1,
          keyVersion = 'v1'
      WHERE name LIKE 'internal:model-test%'
        AND isInternal = 0
    `);

    // 2. REVIVE the tombstoned legacy rows — mint fresh working keys.
    //    Guard: keyHash IS NULL (governance purged the hash), keyVersion
    //    'legacy' (the governance stamp), key LIKE 'revoked-%' (the tombstone
    //    marker), isInternal = 0 (never touch true internal rows).
    const tombstones = db.all(`
      SELECT id, name, category FROM apiKeys
      WHERE keyHash IS NULL
        AND keyVersion = 'legacy'
        AND key LIKE 'revoked-%'
        AND isInternal = 0
    `);
    if (!tombstones.length) return; // nothing to revive — no-op

    const secret = readSecret();
    if (!secret) {
      console.warn(`[DB][migrate] #15 cannot revive legacy keys: API_KEY_SECRET unavailable (file + env both missing)`);
      return;
    }

    const now = new Date().toISOString();
    const mints = []; // { name, key, keyId, keyHash, keyPrefix } — minted once
    for (const t of tombstones) {
      mints.push({ tombstone: t, ...mintKey(secret) });
    }

    // 3. One-time reveal file for the UI (consumed + deleted by
    //    GET /api/keys/pending-reveals). Written BEFORE the DB transaction so a
    //    crash after INSERT but before the file write cannot permanently lose
    //    secrets (the file is the only plaintext record). If the DB transaction
    //    rolls back, the UI surfaces "key not found" — recoverable. The reverse
    //    (DB succeeds, file lost) is permanent secret loss with no recovery.
    writePendingReveal(mints.map(m => ({ name: m.tombstone.name, key: m.key, keyId: m.keyId })));

    for (const m of mints) {
      db.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, allowedKinds, allowedProviders, allowedCombos, isInternal, rateLimitRpm, tokenBudgetDaily, spendCapDailyCents, budgetScope, expiresAt, ipAllowlist, category)
         VALUES(?, ?, ?, NULL, 1, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
        [
          m.keyId,
          `vela-minted-${m.keyId}`,
          m.tombstone.name,
          now,
          "v1",
          m.keyHash,
          m.keyPrefix,
          m.tombstone.category || null,
        ]
      );
      // Drop the dead tombstone — its name now lives on the fresh key.
      db.run(`DELETE FROM apiKeys WHERE id = ?`, [m.tombstone.id]);
    }
  },
};
