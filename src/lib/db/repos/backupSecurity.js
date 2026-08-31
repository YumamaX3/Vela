// Storage Covenant Wave B2 — the S1/S2 security layer for export/import.
// Plan: plans/storage-covenant.md lines 469-483 (S1 trust crossing, S2 redaction).
//
// S2 — export redaction BELOW the completeness law. A hardcoded SECRET-FIELD
// list applies to exportSettings() and to exportDb() called with { redact:
// true } — the plaintext HTTP export surface (/api/settings/database GET).
// Completeness and redaction are TWO pin tests that can contradict each other
// loudly (A3 round-trip pins deliberately exclude secret-bearing settings).
// The list is the single source of truth — the backup engine, the HTTP export
// route, and any future artifact producer all redact through HERE.
//
// SCOPE NOTE: redaction is OPT-IN on exportDb because the SAME function also
// feeds runBackup's encrypted artifact path and mirrorSweep's full resync —
// both require FULL fidelity (connection credentials are NOT in the S6
// secret-file bundle, and a resync that redacts upstream tokens would strip
// the twin's OAuth refresh ability). Default exportDb() stays full-fidelity
// BY CONSTRUCTION; only the plaintext surface opts in. Redaction never drops
// rows or tables, so the completeness law (row counts, table presence, kv
// scope enumeration) holds through it.
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

/** S2 — M0 Tag 2: providerConnections.data top-level credential fields that
 *  must never leave the database in a PLAINTEXT export (the data blob the
 *  connectionsRepo round-trips; evidence: connectionsRepo OPTIONAL_FIELDS +
 *  src/lib/oauth/providers/* mapTokens, which persist accessToken/refreshToken/
 *  idToken/apiKey onto the connection row). */
export const CONNECTION_SECRET_FIELDS = [
  "apiKey",
  "accessToken",
  "refreshToken",
  "idToken",
  "token",
  "password",
];

/** S2 — M0 Tag 2: secret fields nested one-or-more levels inside
 *  providerConnections.data (mostly providerSpecificData). Evidence per field:
 *    clientSecret     — kiro.js mapTokens (AWS SSO OIDC client secret, refresh credential)
 *    idToken          — xai.js / grok-cli.js (nested providerSpecificData.idToken)
 *    copilotToken     — github.js mapTokens + tokenRefresh persist path
 *    firebaseIdToken  — windsurf.js mapTokens
 *    machineId        — cursor.js / qoder.js (COSY signing credential — see
 *                       qoderModels cosyCredsFromConnection)
 *    fingerprintId /
 *    fingerprintHash  — freebuff.js mapTokens (device-login artifacts persisted
 *                       into psd after the flow; no post-login reader) */
export const CONNECTION_NESTED_SECRET_FIELDS = [
  "clientSecret",
  "idToken",
  "copilotToken",
  "firebaseIdToken",
  "machineId",
  "fingerprintId",
  "fingerprintHash",
  // Semantic floor at EVERY depth — a field named password/token is a secret
  // by its name alone (no provider stores them today; this is the guard for
  // the next provider that does).
  "password",
  "token",
];

/** Proxy URLs embed credentials as userinfo — `scheme://user:pass@host:port`
 *  is the exact shape the proxy-pools dashboard builds (proxy-pools/page.js
 *  parses `host:port:user:pass` INTO that URL form). A Url-keyed leaf carrying
 *  userinfo is secret-bearing and redacts WHOLE: a restored redacted pool must
 *  fail LOUD on its sentinel, never silently connect unauthenticated. */
const URL_USERINFO_RE = /^[a-z][a-z0-9+.-]*:\/\/[^@/?#]+@/i;

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

// The combined S2 walk set for connection/pool data blobs: every top-level
// credential field PLUS the nested credential fields, applied at EVERY depth
// (secrets ride providerSpecificData in the wild, one-or-more levels down).
const CONNECTION_REDACT_SET = new Set([
  ...CONNECTION_SECRET_FIELDS,
  ...CONNECTION_NESTED_SECRET_FIELDS,
]);

/** S2 — redact secret-bearing fields from a connection/pool data blob, at
 *  ANY nesting depth (providerSpecificData carries clientSecret/idToken/
 *  copilotToken/machineId in the wild). Returns a NEW object — the input is
 *  never mutated. Arrays are walked element-wise; non-secret leaves and keys
 *  with empty/absent values pass through untouched. String leaves carrying
 *  userinfo credentials (proxy URLs) redact WHOLE. */
export function redactSecretConnectionData(data) {
  if (Array.isArray(data)) return data.map((v) => redactSecretConnectionData(v));
  if (typeof data === "string") {
    return URL_USERINFO_RE.test(data) ? REDACTED_SENTINEL : data;
  }
  if (!data || typeof data !== "object") return data;
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (CONNECTION_REDACT_SET.has(key)) {
      out[key] = value === undefined || value === null || value === ""
        ? value
        : REDACTED_SENTINEL;
    } else if (typeof value === "string") {
      out[key] = URL_USERINFO_RE.test(value) ? REDACTED_SENTINEL : value;
    } else if (value && typeof value === "object") {
      out[key] = redactSecretConnectionData(value);
    } else {
      out[key] = value;
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
