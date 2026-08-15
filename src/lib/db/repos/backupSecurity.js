// Storage Covenant Wave B2 — the S1/S2 security layer for export/import.
// Plan: plans/storage-covenant.md lines 469-483 (S1 trust crossing, S2 redaction).
//
// S2 — export redaction BELOW the completeness law. A hardcoded SECRET-FIELD
// list applies to exportSettings()/exportDb(). Completeness and redaction are
// TWO pin tests that can contradict each other loudly (A3 round-trip pins
// deliberately exclude secret-bearing settings). The list is the single source
// of truth — the backup engine, the HTTP export route, and any future artifact
// producer all redact through HERE.
//
// S1 — RESTORE-QUARANTINED fields. importDb() treats the payload as HOSTILE
// input: these fields restore only under an explicit adoptSecrets flag. The
// DEFAULT preserves current values (a decryptable artifact + the restore
// endpoint was a total-takeover chain: attacker-known password hash +
// requireLogin:false + minted keyHashes + outboundProxyUrl pointing at
// attacker infra).

/** S2 — setting keys that must NEVER leave the database in an export.
 *  Covers every PROTECTED_SETTING_KEYS member plus all future secret-bearing
 *  auth fields. The list is hardcoded + pinned by test (plan line 478). */
export const SECRET_SETTING_KEYS = [
  "password",
  "mitmSudoEncrypted",
  "oidcClientSecret",
];

/** S1 — settings keys that restore only under adoptSecrets. */
export const RESTORE_QUARANTINED_SETTING_KEYS = [
  "password",
  "requireLogin",
  "authMode",
  // oidc* — wildcard in the plan; the concrete keys from settingsDefaults:
  "ssoType",
  "oidcIssuerUrl",
  "oidcClientId",
  "oidcClientSecret",
  "oidcScopes",
  "oidcLoginLabel",
];

/** S1 — apiKeys columns that restore only under adoptSecrets. */
export const RESTORE_QUARANTINED_KEY_FIELDS = ["keyHash", "isInternal", "deletedAt"];

/** S2 sentinel — marks a redacted secret field in an export. Never parse it
 *  back as a real value: importDb drops quarantined sentinels, not adopts. */
export const REDACTED_SENTINEL = "[REDACTED]";

/** Redact secret-bearing keys from a raw settings object (S2).
 *  Returns a NEW object — the input is never mutated. */
export function redactSecretSettings(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const out = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    if (key in out && out[key] !== undefined && out[key] !== "") {
      out[key] = REDACTED_SENTINEL;
    }
  }
  return out;
}

/** S1 — strip RESTORE-QUARANTINED fields from a hostile settings payload.
 *  The default restore path keeps current values by never restoring these. */
export function quarantineSettingsPayload(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const out = { ...settings };
  for (const key of RESTORE_QUARANTINED_SETTING_KEYS) delete out[key];
  return out;
}

/** S1 — strip RESTORE-QUARANTINED fields from one apiKeys payload row. */
export function quarantineKeyRow(key) {
  if (!key || typeof key !== "object") return key;
  const out = { ...key };
  for (const f of RESTORE_QUARANTINED_KEY_FIELDS) delete out[f];
  return out;
}
