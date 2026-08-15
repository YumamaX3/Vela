import { getAdapter } from "../../driver.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";
// Storage Covenant A7: the pure settings core lives in the seam so BOTH
// harbors merge identically — no default drift between twins.
import { mergeWithDefaults } from "../settingsDefaults.js";

export { mergeWithDefaults }; // the facade contract re-exports it

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
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

// S2 (Storage Covenant Wave B2) — secret-field redaction applies BELOW the
// completeness law: exportSettings() never leaks password / mitmSudoEncrypted /
// oidcClientSecret. The HTTP route strip is defense-in-depth, not the gate.
export async function exportSettings() {
  const { redactSecretSettings } = await import("../backupSecurity.js");
  return redactSecretSettings(await readRaw());
}
