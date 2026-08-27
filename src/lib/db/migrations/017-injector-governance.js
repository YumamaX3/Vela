/**
 * Migration 017: injector governance — AI Lab (v0.9.26)
 *
 * The AI Lab's data seam (Shorekeeper-Sealed Plan §W0, plans/vela-ai-lab-hybrid.md):
 *   1. apiKeys.allowedInjectors   — tri-state JSON (NULL=all, []=deny, [ids]=whitelist)
 *   2. apiKeys.allowedModes       — tri-state JSON for x-vela-mode selection
 *   3. apiKeys.defaultMode        — the mode name/id used when no header is sent
 *   4. apiKeys.injectVarAllowlist — governs x-vela-inject-var-* overrides
 *                                   (NULL=all overrides — back-compat, consistent with
 *                                    the tri-state convention where NULL means "all",
 *                                    []=deny all, [names]=named allowlist)
 *   5. settings.userInjectors UUID backfill — deterministic HASH-DERIVED ids so the
 *      SQLite primary and the MariaDB twin converge on identical ids with zero
 *      coordination (mirror-outbox never diverges): uuid = formatUuid(sha256(
 *      'vela-injector:' + name + ':' + index)). The index is included so two
 *      same-named entries cannot collide to one uuid.
 *
 * SCHEMA_VERSION moves 15 → 17 in schema.js (Covenant M1 — both numbers move
 * together; migration 016 carries version:16 so latestVersion() is already 17
 * after this migration registers — the pre-existing 016 off-by-one is closed by
 * setting SCHEMA_VERSION to latestVersion() in the same wave).
 *
 * ADAPTER CONTRACT (learned the hard way, v0.9.19/20/22 boot storms): the
 * adapter surface is run/get/all/exec/transaction — NO raw prepare(). Use
 * db.all(`PRAGMA table_info(...)`) + db.exec(...) exactly like migration 002/013.
 *
 * Idempotency: every statement is guarded (PRAGMA presence checks) so a crash
 * between DDL and version-meta re-runs cleanly (Covenant H2).
 */

import crypto from "node:crypto";

const NEW_COLUMNS = [
  { name: "allowedInjectors", ddl: "TEXT" },
  { name: "allowedModes", ddl: "TEXT" },
  { name: "defaultMode", ddl: "TEXT" },
  { name: "injectVarAllowlist", ddl: "TEXT" },
];

const up = (db) => {
  // 1. Add the four tri-state columns to apiKeys — guarded by PRAGMA presence
  //    checks (idempotent; portable adapter surface only — never db.prepare).
  const cols = db.all(`PRAGMA table_info(apiKeys)`);
  const existing = new Set((cols || []).map((c) => c.name));
  for (const col of NEW_COLUMNS) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }

  // 2. Backfill deterministic hash-derived UUIDs onto name-keyed
  //    settings.userInjectors entries. The settings row is a single TEXT blob;
  //    read → map (only entries lacking `id`) → write back atomically.
  //    Deterministic (hash of name+index) so the SQLite primary and the MariaDB
  //    twin converge on identical ids without coordination. Idempotent: entries
  //    that already carry an `id` are left untouched.
  try {
    const rows = db.all(`SELECT data FROM settings WHERE id = 1`);
    if (rows && rows.length === 1 && typeof rows[0].data === "string") {
      const blob = JSON.parse(rows[0].data);
      if (blob && Array.isArray(blob.userInjectors)) {
        let changed = false;
        for (let i = 0; i < blob.userInjectors.length; i++) {
          const inj = blob.userInjectors[i];
          if (inj && typeof inj === "object" && typeof inj.id !== "string") {
            inj.id = backfillId(inj.name, i);
            changed = true;
          }
        }
        if (changed) {
          db.run(`UPDATE settings SET data = ? WHERE id = 1`, [JSON.stringify(blob)]);
        }
      }
    }
  } catch (err) {
    // The backfill is best-effort: a malformed blob must not block the DDL.
    // The lazy normalizer on settings read is the safety net (plan §S6).
    // Re-throw is deliberately avoided — the migration still lands.
  }
};

/** Deterministic id: formatUuid(sha256('vela-injector:' + name + ':' + index)). */
function backfillId(name, index) {
  const input = `vela-injector:${name == null ? "" : name}:${index}`;
  // sha256 hex → uuid-v4-shaped string. Deterministic so the SQLite primary and
  // the MariaDB twin converge on identical ids without coordination.
  const hex = crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16] || "8", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const down = (db) => {
  // Rollback path: drop the four columns. The backfill is NOT reverted (the
  // ids remain harmless orphans in the blob — the standard migration covenant
  // H5 accepts data not preserved on rollback).
  const cols = db.all(`PRAGMA table_info(apiKeys)`);
  const existing = new Set((cols || []).map((c) => c.name));
  for (const col of NEW_COLUMNS) {
    if (existing.has(col.name)) {
      db.exec(`ALTER TABLE apiKeys DROP COLUMN ${col.name}`);
    }
  }
};

export default { version: 17, name: "injector-governance", up, down };
export { up, down };
