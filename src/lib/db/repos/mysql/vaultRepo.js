// VAULT REPOSITORY — MySQL/MariaDB twin.
//
// Same contract and same slot law as the sqlite harbor. The only deliberate
// difference is the pre-migration backup: the sqlite harbor can take a
// transactionally consistent snapshot with VACUUM INTO, while the twin has no
// equivalent single-statement copy. It therefore seals in place and relies on
// the primary's backup ledger — said plainly here rather than pretending.
import { getMysqlAdapter } from "../../mysql/adapter.js";
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
  const db = await getMysqlAdapter();
  const rows = await db.all(
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
    if (hasCiphertext && !hasPlain) sealed++;
    else plaintext++;
  }
  return { sealed, plaintext, total: rows.length };
}

export async function listConnectionsNeedingSeal() {
  const db = await getMysqlAdapter();
  const rows = await db.all(`SELECT id, data FROM providerConnections`);
  return rows
    .filter((row) => hasPlaintextCredential(parseData(row.data) || {}))
    .map((row) => ({ id: row.id, data: row.data }));
}

export async function migratePlaintextCredentials() {
  const vault = getVault();
  if (!vault.enabled) return { enabled: false, sealed: 0, skipped: [], backup: null };

  const candidates = await listConnectionsNeedingSeal();
  if (!candidates.length) return { enabled: true, sealed: 0, skipped: [], backup: null };

  const db = await getMysqlAdapter();
  let sealed = 0;
  const skipped = [];
  for (const candidate of candidates) {
    const parsed = parseData(candidate.data);
    if (!parsed) { skipped.push(`${candidate.id}: data is not a JSON object`); continue; }
    try {
      const { conn, slots } = sealConnection(parsed);
      if (!slots || !Object.keys(slots).length) continue;
      const { sql, params } = updateSealedSql(slots);
      await db.run(sql, [JSON.stringify(conn), ...params, candidate.id]);
      sealed++;
    } catch (e) {
      skipped.push(`${candidate.id}: ${e.message}`);
      console.warn(`[vault] connection ${candidate.id} not sealed, left plaintext: ${e.message}`);
    }
  }
  return { enabled: true, sealed, skipped, backup: null };
}

export async function rewrapConnectionDEKs(newMasterKey) {
  const vault = getVault();
  if (!vault.enabled) throw new VaultError("credential vault is disabled", ERR_DISABLED);
  const db = await getMysqlAdapter();
  const rows = await db.all(
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
        await db.run(
          `UPDATE providerConnections SET ${wrappedCol} = ?, updatedAt = ? WHERE id = ?`,
          [next, new Date().toISOString(), row.id]
        );
        rewrapped++;
      } catch {
        failures.push(`${row.id}/${slot}`);
      }
    }
  }
  return { rewrapped, failures };
}
