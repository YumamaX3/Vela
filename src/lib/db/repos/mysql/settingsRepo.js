// Storage Covenant Wave A7 — the mysql twin of sqlite/settingsRepo.js.
// Native async (mysql2 is network-bound); ON DUPLICATE KEY UPDATE rides the
// settings PRIMARY KEY (id). The merge logic is the SHARED pure core in
// repos/settingsDefaults.js — both twins merge identically.
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";
import { mergeWithDefaults } from "../settingsDefaults.js";

export { mergeWithDefaults }; // the facade contract re-exports it

async function readRaw() {
  const db = await getMysqlAdapter();
  const row = await db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside a connection-bound transaction.
export async function updateSettings(updates) {
  const db = await getMysqlAdapter();
  let next;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    await tx.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      [stringifyJson(next)],
    );
  });
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

// S2 (Storage Covenant Wave B2) — same redaction law as the sqlite twin:
// exportSettings() never leaks password / mitmSudoEncrypted / oidcClientSecret.
export async function exportSettings() {
  const { redactSecretSettings } = await import("../backupSecurity.js");
  return redactSecretSettings(await readRaw());
}
