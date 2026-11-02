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
 *  idToken/apiKey onto the connection row).
 *
 *  Despite the CONNECTION_ name this set also governs proxyPools: the walk at
 *  redactSecretConnectionData is applied to BOTH data blobs (see
 *  sqlite/backupRepo.js:70 and :75, and the mysql twin at :37 and :42). §5.2's
 *  relayToken is a proxy-pool field that lives here for exactly that reason —
 *  measured, not assumed: a probe of this walk with a realistic relay pool blob
 *  returned the token verbatim before it was added, because a 43-char opaque
 *  token carries no userinfo and so URL_USERINFO_RE never fires on it. The name
 *  is now narrower than the set's reach; renaming it would touch every importer
 *  for no behavioural gain, so the reach is documented instead. */
export const CONNECTION_SECRET_FIELDS = [
  "apiKey",
  "accessToken",
  "refreshToken",
  "idToken",
  "token",
  "password",
  // §5.2 — the per-pool relay bearer secret. Rides proxyPools.data, is minted at
  // deploy, and is delivered to a platform secret store that is write-only on all
  // three platforms (Vercel "sensitive" is never decryptable; Cloudflare's
  // GET …/secrets returns name+type with the value omitted; Deno omits `value`
  // when secret:true). So this row is the ONLY readable copy — which is also why
  // it must never leave in a plaintext export.
  //
  // relayVersion is deliberately NOT here: it is a protocol marker, not a secret,
  // and a restore that dropped it would silently re-allow a v1 relay to receive a
  // token it would then forward upstream.
  "relayToken",
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
  // S1/DLV-1 (CRITICAL) — mitmSudoEncrypted is in SECRET_SETTING_KEYS, so it is
  // redacted to the "[REDACTED]" sentinel on EVERY export. Without it here, a
  // default restore (adoptSecrets=false — the documented safe path) captured no
  // current value, DELETEs the settings row, and writes the literal sentinel
  // back over the live credential: the operator's MITM sudo password is gone.
  // It is IRREVERSIBLE — the artifact never carried the real value, so
  // adoptSecrets=true cannot bring it back, and decryptPassword("[REDACTED]")
  // fails into the swallow-all catch at mitm/manager.js. mirrorSweep.js:24-28
  // documents this exact hole and patches it there; the restore path never got
  // the fix. This is that fix.
  "mitmSudoEncrypted",
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

/** Masking — the OUTBOUND-event redactor (src/lib/webhooks.js).
 *
 *  Distinct from redactSecret* above on purpose. Those write the "[REDACTED]"
 *  SENTINEL into artifacts — a value a reader is meant to fail LOUD on. An
 *  event payload is read by a machine (a webhook receiver, a chat bridge), so
 *  it is MASKED instead: a credential keeps its shape (length, last 4) but not
 *  its secret, and no secret-shaped string survives the walk. The key set is the
 *  SAME single source of truth (run it here rather than keeping a second list
 *  that drifts from the first).
 *
 *  What masks:
 *    • any field whose name IS a known credential (apiKey/accessToken/…) or
 *      LOOKS like one (key?, *Secret, *Token, password, authorization,
 *      cookie, credential*, webhookSecret, botToken, …) at ANY depth;
 *    • any string that carries the shape of a secret — `Bearer …`, `sk-…`,
 *      `ghp_…`, `AKIA…`, a JWT — wherever it rides, whatever its key;
 *    • a URL's userinfo (`scheme://user:pass@host` → `scheme://user:***@host`);
 *      the host:port stays legible, which is what a receiver needs to tell
 *      pools apart.
 *
 *  What deliberately does NOT mask: free-form USER CONTENT — prompt, content,
 *  text, message, body, title, description, error, … — because a provider
 *  error line may legitimately quote a prompt, and a webhook that rewrites
 *  every "token" in prose is a webhook nobody can read. Credential FIELDS and
 *  secret-SHAPED strings are masked regardless; only a bare low-entropy word
 *  inside prose survives, which is exactly the "token count" the operator
 *  meant to see. */
// (A field-name allow-list of "prose" keys is deliberately NOT used: a string
// under ANY non-credential key is masked when it carries a secret's shape, and
// left alone otherwise — "token budget at 90%" and an `aws: "AKIA…"` both get
// exactly what they deserve, regardless of the key they ride under.)
const SECRET_KEY_RE =
  /(api[-_]?key|access[-_]?key|secret|passw(or)?d|authorization|cookie|credential|token|private[-_]?key|signature)/i;
const CONTENT_CARRYING_RE = /inject|prompt/i;
const VENDOR_ALIAS_RE =
  /^(aws|gcp|azure|openai|anthropic|google|gemini|mistral|cohere|groq|deepseek|xai|stripe|twilio|sendgrid|github|gitlab|slack|telegram|discord|huggingface)$/i;

function looksLikeCredentialField(key) {
  if (typeof key !== "string" || !key) return false;
  if (CONNECTION_REDACT_SET.has(key) || SECRET_SETTING_KEYS.includes(key)) return true;
  if (SECRET_KEY_RE.test(key)) return true;
  // A credential-adjacent alias (`aws`, `openai`, `stripe`, `anthropic`, …):
  // operators routinely park a provider credential under the provider's own
  // name. A bare, lower-cased vendor key with no extra words is such an alias;
  // a field like `awsRegion` or `openaiModel` is NOT (it has extra words) and
  // rides untouched.
  if (VENDOR_ALIAS_RE.test(key)) return true;
  // Content-carrying RELAY fields (proxyInjection: {type, value}) are prompts,
  // not credentials — a token-shaped word inside one is the operator's prose.
  if (CONTENT_CARRYING_RE.test(key)) return false;
  return /(^|[-_])key$/i.test(key);
}

/** Is this STRING the shape of a secret? Exported for the test vector. */
export function looksLikeSecretString(value) {
  if (typeof value !== "string" || !value) return false;
  if (/^Bearer\s+\S+/i.test(value)) return true;
  if (/\bsk-[A-Za-z0-9_-]{8,}/.test(value)) return true;
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(value)) return true;
  if (/\bAKIA[0-9A-Z]{16}\b/.test(value)) return true;
  if (/\bxox[abpsr]-[A-Za-z0-9-]{8,}/.test(value)) return true;
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/.test(value)) return true;
  return false;
}

/** Mask ONE secret leaf: keep the tail so an operator can tell two keys apart. */
function maskSecretValue(value) {
  if (value === undefined || value === null || value === "") return value;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= 16) return "***";
  // The tail is kept ONLY when it cannot itself read as a secret (an AWS id's
  // last 4 uppercase letters alone — "MNOP" — would trip the AWS pattern, so a
  // disguised fragment could survive). Short value or secret-shaped tail ⇒ all masked.
  // A tail that cannot be told apart from a secret on its own (`MNOP` reads as
  // an AWS id fragment) is never emitted — the whole value masks instead. Four
  // uppercase letters make a distinctive fingerprint, the house rule.
  const tail = str.slice(-4);
  if (/^[A-Z]{4}$/.test(tail) || looksLikeSecretString(tail)) return "***";
  return `***${tail}`;
}

/** Mask a URL's userinfo password; everything else of the URL survives. */
export function maskUrlUserinfo(value) {
  if (typeof value !== "string") return value;
  return value.replace(/^([a-z][a-z0-9+.-]*):\/\/([^@/?#]*@)/i, (m, scheme, userinfo) => {
    const at = userinfo.lastIndexOf("@");
    const creds = userinfo.slice(0, at);
    const colon = creds.indexOf(":");
    if (colon < 0) return `${scheme}://***@`;
    return `${scheme}://${creds.slice(0, colon)}:***@`;
  });
}

/**
 * Deep-mask a payload destined for an outbound event. Pure — returns NEW
 * objects/arrays, never mutates the input. Bounded: cycle-safe (a repeated
 * reference is emitted once, then elided) and depth-capped, so a pathological
 * payload can never hang a fire-and-forget delivery.
 */
export function maskSecretPayload(payload, { depth = 0, seen = new WeakSet() } = {}) {
  if (depth > 12) return "[TRUNCATED]";
  if (Array.isArray(payload)) {
    return payload.map((v) => maskSecretPayload(v, { depth: depth + 1, seen }));
  }
  if (typeof payload === "string") {
    if (looksLikeSecretString(payload)) return maskSecretValue(payload);
    return maskUrlUserinfo(payload);
  }
  if (!payload || typeof payload !== "object") return payload;
  if (seen.has(payload)) return "[CYCLE]";
  seen.add(payload);
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    // A content-carrying object (a list of injections) keeps its prose values
    // untouched EXCEPT credential-named fields — handled by the recursion.
    if (looksLikeCredentialField(key)) {
      out[key] = maskSecretValue(value);
    } else if (typeof value === "string") {
      // A STRING LEAF under a non-credential key is masked only when it carries a
      // secret's SHAPE — `aws: "EXAMPLE-AWS..."`, a bare `sk-…` riding any field.
      // Content fields are no exception: prose without a secret shape (the
      // "token budget" case) passes untouched, so this is the strict version.
      out[key] = looksLikeSecretString(value) ? maskSecretValue(value) : maskUrlUserinfo(value);
    } else {
      out[key] = maskSecretPayload(value, { depth: depth + 1, seen });
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

// ── Selective import (the sections law) ──────────────────────────────────
// A backup file is the whole database, but an operator should not have to
// restore the whole database to move one part of it. The file's payload is
// partitioned into seven SECTIONS; a selective restore wipes and refills only
// the sections the operator names, and only what the file actually carries.
// This map is the single source of truth — both posture twins (sqlite +
// mysql) and the /api/settings/database route read it from HERE, so the UI's
// checkbox list can never drift from what the engine actually restores.
//
// Partition rules, load-bearing:
//   • every payload field belongs to EXACTLY ONE section (an unknown field in
//     the UI is therefore an unknown field to the engine too — honest by
//     construction);
//   • `kvScopes` and its legacy named views (modelAliases/customModels/…) are
//     ONE section — the import path treats them as alternatives for the same
//     kv table, so splitting them would let an operator half-restore a scope
//     through the door the other half came in;
//   • `usage` covers usageHistory + usageDaily + requestDetails: the
//     Observatory ledgers rise and fall together (the live-data exporters
//     already treat them as one pool of data);
//   • `settings` (the id=1 row) is its own section and stays the default in
//     every UI — the whole-restore path (no `sections` given) keeps its
//     EXACT current behaviour, so existing callers (the backup engine, the
//     mirror resync) change nothing.
/** The seven import sections, in UI display order. */
export const IMPORT_SECTIONS = [
  "settings",
  "connections",
  "pools",
  "keys",
  "combos",
  "kv",
  "usage",
];
/** Which payload fields each section covers. `kv` covers both the A3
 *  generic kvScopes envelope and every legacy named view of it. */
export const IMPORT_SECTION_FIELDS = {
  settings: ["settings"],
  connections: ["providerConnections", "providerNodes"],
  pools: ["proxyPools"],
  keys: ["apiKeys"],
  combos: ["combos"],
  kv: [
    "kvScopes", "injections", "modelAliases", "customModels", "mitmAlias",
    "pricing", "pricingSync", "disabledModels",
  ],
  usage: ["usageHistory", "usageDaily", "requestDetails"],
};
/** Flatten IMPORT_SECTION_FIELDS — which payload field a section covers. */
const FIELD_TO_SECTION = new Map(
  Object.entries(IMPORT_SECTION_FIELDS).flatMap(([section, fields]) =>
    fields.map((f) => [f, section])
  )
);
/** Validate + normalize a caller's `sections` option. Returns null when no
 *  valid selection was given (→ whole restore, byte-identical behaviour).
 *  Unknown names are dropped loudly at the route; here they are simply not
 *  selectable, so a typo can never silently widen the wipe. */
export function normalizeImportSections(sections) {
  if (!Array.isArray(sections)) return null;
  const valid = [...new Set(sections)].filter((s) => IMPORT_SECTIONS.includes(s));
  if (valid.length === 0) return null;
  if (valid.length === IMPORT_SECTIONS.length) return null; // all seven == whole restore
  return valid;
}
/** Which section a payload field belongs to (or null for an unknown field). */
export function sectionOfField(field) {
  return FIELD_TO_SECTION.get(field) ?? null;
}
/** Project a whole export payload down to the selected sections — the export
 *  studio's law. Pure (returns a NEW object, never mutates), and the mirror of
 *  IMPORT_SECTION_FIELDS: a file exported with `sections` is, by construction,
 *  a file the selective import can restore with the same `sections`. `_meta`
 *  is always kept (provenance), annotated with what was projected, and every
 *  field the payload does not carry is simply absent — never an empty stand-in
 *  that would read as "this section was empty" when the truth is "not asked
 *  for". */
export function projectPayloadToSections(payload, sections) {
  const selected = normalizeImportSections(sections);
  const out = { _meta: { ...(payload?._meta ?? {}), sections: selected ?? [...IMPORT_SECTIONS] } };
  if (!selected) return { ...payload, _meta: out._meta };
  for (const section of selected) {
    for (const field of IMPORT_SECTION_FIELDS[section] || []) {
      if (payload?.[field] !== undefined) out[field] = payload[field];
    }
  }
  return out;
}


// ── The scoped-backup law (export/restore by scope) ─────────────────────
// A scoped backup is a deliberate CROP of the payload, and its artifact must
// say so: the manifest declares exactly what it carries (sections + explicit
// provider ids + whether that list was complete). The RESTORE reads the same
// declaration, so "what this file replaces" is never inferred from what
// happens to be in it — a scoped file replaces EXACTLY its declared sections,
// a full file keeps the historical whole restore.
//
// The section vocabulary here is the BACKUP crop's, intentionally narrower
// than IMPORT_SECTIONS: a scoped backup can narrow `connections` to explicit
// provider rows (IMPORT_SECTIONS cannot — a section is all-or-nothing there),
// so it needs its own field map. `keys`/`settings` still ride their existing
// quarantine/store, never a second route.
export const SCOPED_BACKUP_SECTIONS = ["providers", "keys", "combos", "proxyPools", "injections", "settings"];

/** Which export payload fields one scoped section carries. `providers` rides
 *  providerConnections (provider id rows) + providerNodes; `injections` is the
 *  user-injector list, which lives inside settings (userInjectors) — carried
 *  as its own top-level field so a file with BOTH can still crop it alone. */
export const SCOPED_SECTION_FIELDS = {
  providers: ["providerConnections", "providerNodes"],
  keys: ["apiKeys"],
  combos: ["combos"],
  proxyPools: ["proxyPools"],
  injections: ["injections"],
  settings: ["settings"],
};

/** The payload fields that ride a provider SUBSTRING: their keys are provider
 *  ids, so a provider-scoped crop filters them by the same id list. */
export const PROVIDER_SCOPED_FIELDS = ["relay", "disabledModels", "pricing"];

/**
 * Normalize a caller's scope. Returns null for "no scope" (a full backup —
 * byte-identical behaviour for every existing caller) and throws on anything
 * malformed: a typo'd section name must fail loudly at the door, never widen
 * or silently narrow a crop.
 */
export function normalizeBackupScope(scope) {
  if (scope === undefined || scope === null) return null;
  if (typeof scope !== "object" || Array.isArray(scope)) {
    throw new Error("scope must be an object { sections?, providers? }");
  }
  const hasSections = scope.sections !== undefined;
  // null reads as ABSENT, not malformed: the export path itself emits
  // `providers: null` for a scope with no provider crop (backupRepo's
  // `normalized.providers ?? null`), so a normalize that throws on null would
  // refuse the very artifact the house minted. undefined is absent by the
  // same law; a non-array, non-null value is a malformed scope.
  const hasProviders = scope.providers !== undefined && scope.providers !== null;
  if (!hasSections && !hasProviders) return null;
  const out = {};
  if (hasSections) {
    if (!Array.isArray(scope.sections) || scope.sections.some((s) => typeof s !== "string")) {
      throw new Error("scope.sections must be an array of section names");
    }
    const unknown = [...new Set(scope.sections)].filter((s) => !SCOPED_BACKUP_SECTIONS.includes(s));
    if (unknown.length) {
      throw new Error(
        `Unknown scope section(s): ${unknown.join(", ")} — valid: ${SCOPED_BACKUP_SECTIONS.join(", ")}`
      );
    }
    // A section WITHOUT a provider list is the whole section. A section WITH
    // one is cropped to it — and cropping requires the list, so an empty
    // provider list is a refusal, never "everything" (the classic empty-means-all).
    out.sections = [...new Set(scope.sections)];
    if (out.sections.length === 0) throw new Error("scope.sections must not be empty");
  }
  if (hasProviders) {
    if (!Array.isArray(scope.providers) || scope.providers.some((p) => typeof p !== "string" || !p.trim())) {
      throw new Error("scope.providers must be a non-empty array of provider ids");
    }
    out.providers = [...new Set(scope.providers.map((p) => p.trim()))];
    if (out.providers.length === 0) throw new Error("scope.providers must not be empty");
    // A provider list with no section list means "these providers' cargo":
    // connections, nodes, their keys, combos and pools. providers is implied.
    if (!hasSections) out.sections = ["providers", "keys", "combos", "proxyPools"];
    if (!out.sections.includes("providers")) out.sections.push("providers");
  }
  return out;
}

/** The declared section set of a scope (null ⇒ full). Ordered per the vocabulary. */
export function sectionIdsForScope(scope) {
  if (!scope) return null;
  return SCOPED_BACKUP_SECTIONS.filter((s) => (scope.sections || []).includes(s));
}

/** Does this scope crop `field`'s rows by the provider list? */
export function isProviderScopedField(scope, field) {
  if (!scope || !Array.isArray(scope.providers)) return false;
  return field === "providerConnections" || field === "providerNodes" || PROVIDER_SCOPED_FIELDS.includes(field);
}


// ── The import side of the scope law ─────────────────────────────────────
// A scoped artifact restores EXACTLY what it declared. `scope` reaches
// importDb on two routes: (a) the manifest recorded in the artifact, (b) the
// caller's explicit option. They must AGREE where both exist — a full
// artifact blessed by a scoped request (or the reverse) is a refusal, not a
// guess, because guessing writes the wrong rows at the moment trust is
// extended. `implicitSections` are the import sections a scope necessarily
// touches as a side effect of its own cross-references (a provider crop rides
// the settings row for document refs), so they are restored but never counted
// as a failure of the artifact's declaration.
export function sameScope(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const norm = (x) => JSON.stringify({
    sections: sectionIdsForScope(x) || [],
    providers: [...(x.providers || [])].sort(),
  });
  return norm(a) === norm(b);
}

/** The import sections a scope touches without declaring them. */
export function implicitSectionsForScope(scope) {
  if (!scope) return [];
  const out = new Set();
  const declaresProviders = (scope.sections || []).includes("providers");
  // A provider-specific crop keeps connection documents' settings references
  // alive by restoring the settings row from the file (never wiping it).
  if (declaresProviders && Array.isArray(scope.providers)) out.add("settings");
  // Combos carry model refs to providers; their rows are the combo table only.
  return [...out];
}

/** Which IMPORT section each scope section restores. */
const IMPORT_SECTION_FOR_SCOPE = {
  providers: "connections",
  keys: "keys",
  combos: "combos",
  proxyPools: "pools",
  injections: "kv", // userInjectors ride the kv table, scope "userInjectors"
  settings: "settings",
};

/**
 * The import-side predicate set for a scope. Returns null for a full restore
 * (historical behaviour, byte-identical) or
 *   { scope, want, mayDelete, providerSubset }
 *   • want(s)       — is import section `s` part of this restore at all?
 *   • mayDelete(s)  — may the restore WIPE `s` before refilling it? A declared
 *                     section may; an implicit one (a provider crop's settings
 *                     row) is restored over, never wiped.
 *   • providerSubset — an explicit provider list makes EVERY touched section
 *                     row-granular: a crop that wiped `combos` to refill it with
 *                     2 of 9 rows, or keys to 1 of 12, would silently delete the
 *                     rest — the no-cross-ref-collateral rule.
 * Anything the scope does not map (usage, kv beyond injections, requestDetails)
 * is untouched by construction.
 */
export function scopeImportPlan(scope) {
  if (!scope) return null;
  const declared = new Set(
    (sectionIdsForScope(scope) || []).map((s) => IMPORT_SECTION_FOR_SCOPE[s])
  );
  const implicit = new Set(implicitSectionsForScope(scope).map((s) => s));
  return {
    scope,
    want: (importSection) => declared.has(importSection),
    mayDelete: (importSection) => declared.has(importSection) && !implicit.has(importSection),
    providerSubset: Array.isArray(scope.providers) && scope.providers.length > 0,
  };
}
