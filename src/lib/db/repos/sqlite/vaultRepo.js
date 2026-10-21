// VAULT REPOSITORY — sqlite harbor.
//
// Three jobs, all of them row-shaped:
//   1. COUNT what is sealed and what is still plaintext (the status route).
//   2. SEAL plaintext credentials left by pre-vault installs (boot migration).
//   3. REWRAP stored DEKs when the master key rotates (ciphertext untouched).
//
// Sealing on write already covers every new credential; the migration is for
// the rows an install accumulated before the key existed. It is fail-safe, not
// fail-closed: one unsealable row keeps its plaintext and is named, because a
// running gateway with one unsealed row beats an unbootable one.
import fs from "node:fs";
import path from "node:path";
import { getAdapter } from "../../driver.js";
import { DATA_FILE } from "../../paths.js";
import { getVault, VaultError, ERR_DISABLED } from "../../../vault.js";
import {
  sealConnection, hasPlaintextCredential,
  SEALED_SLOTS, SLOT_COLUMNS, SEALED_COLUMN_SQL,
} from "../../connectionVault.js";

function parseData(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function updateSealedSql(slots) {
  const sets = ["data = ?"];
  const params = [];
  for (const slot of SEALED_SLOTS) {
    if (!(slot in slots)) continue;
    const [wrappedCol, cipherCol] = SLOT_COLUMNS[slot];
    sets.push(`${wrappedCol} = ?`, `${cipherCol} = ?`);
    params.push(slots[slot]?.wrappedDEK ?? "", slots[slot]?.ciphertext ?? "");
  }
  return { sql: `UPDATE providerConnections SET ${sets.join(", ")} WHERE id = ?`, params };
}

export async function getVaultCounts() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, data, ${SEALED_COLUMN_SQL} FROM providerConnections`
  );
  let sealed = 0;
  let plaintext = 0;
  for (const row of rows) {
    const hasCiphertext = SEALED_SLOTS.some((slot) => {
      const [, cipherCol] = SLOT_COLUMNS[slot];
      return Boolean(row[cipherCol]);
    });
    const hasPlain = hasPlaintextCredential(parseData(row.data) || {});
    // A row with neither ciphertext nor a plaintext credential is not "sealed";
    // it is simply empty, and the Go status route counts those as plaintext.
    if (hasCiphertext && !hasPlain) sealed++;
    else plaintext++;
  }
  return { sealed, plaintext, total: rows.length };
}

export async function listConnectionsNeedingSeal() {
  const db = await getAdapter();
  const rows = db.all(`SELECT id, data FROM providerConnections`);
  return rows
    .filter((row) => hasPlaintextCredential(parseData(row.data) || {}))
    .map((row) => ({ id: row.id, data: row.data }));
}

/** VACUUM INTO takes a transactionally consistent snapshot (WAL-safe). */
function backupBeforeMigration(db) {
  if (!DATA_FILE) return null;
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const target = path.join(dir, `pre-vault-${stamp}.sqlite`).replace(/\\/g, "/");
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

export async function migratePlaintextCredentials() {
  const vault = getVault();
  if (!vault.enabled) return { enabled: false, sealed: 0, skipped: [], backup: null };

  const candidates = await listConnectionsNeedingSeal();
  if (!candidates.length) return { enabled: true, sealed: 0, skipped: [], backup: null };

  const db = await getAdapter();
  let backup = null;
  try {
    backup = backupBeforeMigration(db);
  } catch (e) {
    // The backup is the only way back if the master key turns out to be wrong
    // for these rows. A backup that cannot be written is a hard stop.
    return { enabled: true, sealed: 0, skipped: [], backup: null, error: `pre-migration backup failed: ${e.message}` };
  }

  let sealed = 0;
  const skipped = [];
  for (const candidate of candidates) {
    const parsed = parseData(candidate.data);
    if (!parsed) { skipped.push(`${candidate.id}: data is not a JSON object`); continue; }
    try {
      const { conn, slots } = sealConnection(parsed);
      if (!slots || !Object.keys(slots).length) { continue; }
      const { sql, params } = updateSealedSql(slots);
      db.run(sql, [JSON.stringify(conn), ...params, candidate.id]);
      // The statement above is built as: data = ?, <slot cols...> WHERE id = ?
      sealed++;
    } catch (e) {
      skipped.push(`${candidate.id}: ${e.message}`);
      console.warn(`[vault] connection ${candidate.id} not sealed, left plaintext: ${e.message}`);
    }
  }
  return { enabled: true, sealed, skipped, backup };
}

export async function rewrapConnectionDEKs(newMasterKey) {
  const vault = getVault();
  if (!vault.enabled) throw new VaultError("credential vault is disabled", ERR_DISABLED);
  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, ${SEALED_COLUMN_SQL} FROM providerConnections
     WHERE secretWrappedDEK <> '' OR tokenWrappedDEK <> '' OR refreshWrappedDEK <> ''`
  );

  let rewrapped = 0;
  const failures = [];
  for (const row of rows) {
    for (const slot of SEALED_SLOTS) {
      const [wrappedCol] = SLOT_COLUMNS[slot];
      const wrapped = row[wrappedCol];
      if (!wrapped) continue;
      try {
        const next = vault.rewrap(wrapped, newMasterKey);
        db.run(
          `UPDATE providerConnections SET ${wrappedCol} = ?, updatedAt = ? WHERE id = ?`,
          [next, new Date().toISOString(), row.id]
        );
        rewrapped++;
      } catch {
        // Never rewrite a row whose DEK cannot be unwrapped: a rotation must
        // not destroy what it cannot read.
        failures.push(`${row.id}/${slot}`);
      }
    }
  }
  return { rewrapped, failures };
}
