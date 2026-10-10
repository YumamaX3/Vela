// Storage Covenant Wave A7 — the pure settings core, shared by BOTH harbors.
// DEFAULT_SETTINGS + mergeWithDefaults carry no persistence — they are logic,
// not SQL, so they live in the seam (not duplicated into each harbor, where a
// new setting would drift between twins). Both repos/sqlite/settingsRepo.js
// and repos/mysql/settingsRepo.js import from here.

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:32060";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

export const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  // W10 (proxy control-plane rebirth, F1) — route rules: destination → egress.
  // Shape: [{id, enabled, match:{hostSuffix?, provider?, modelPrefix?},
  //          action:{poolId?|poolIds?}}]. FIRST match wins (stage order). The
  // pipeline's rule-resolve consumes these via selection.syncSeams; there is
  // NO operator editor by design (the plan's refuse-the-document law — C's
  // fallbackRules editor precedent does not exist here), so the array arrives
  // only through settings import/CLI, and an invalid entry is skipped by the
  // stage's own matcher, never by a validator that would block boot.
  proxyRoutingRules: [],
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: true,
  requireApiKey: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  ssoType: "oidc",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  samlEntryPoint: "",
  samlIssuer: "urn:Vela:sp",
  samlCert: "",
  samlLoginLabel: "Sign in with SAML SSO",
  samlAttributeEmail: "email",
  samlAttributeName: "name",
  enableObservability: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  // Network timeout policy (the Network lens's Timeouts card). `null` means
  // "inherit the env/default floor" — the historical behavior — so a harbor
  // that never opens the card behaves exactly as before. A positive number
  // overrides it live (see open-sse/config/runtimeConfig.js
  // applyNetworkTimeoutOverrides). The env vars STREAM_STALL_TIMEOUT_MS /
  // STREAM_FIRST_CHUNK_TIMEOUT_MS / FETCH_CONNECT_TIMEOUT_MS stay the floor.
  streamStallTimeoutMs: null,
  streamFirstChunkTimeoutMs: null,
  fetchConnectTimeoutMs: null,
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomTimeoutMs: 3000,
  headroomCompressUserMessages: false,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  // Usage Observatory W3-C — budget alert channels. Webhook URLs are
  // operator-supplied and secret-bearing (a Discord webhook URL carries a
  // token) — the delivery layer never logs them.
  budgetAlerts: {
    discordEnabled: false,
    discordWebhookUrl: "",
    n8nEnabled: false,
    n8nWebhookUrl: "",
    // Usage Observatory W3-D — the weekly usage digest rides the same
    // operator-configured channels as the budget alerts.
    weeklyDigestEnabled: false,
  },
  // Log Pipeline v2 §8 — the durable log ledger's retention posture.
  //
  // `age` is the DEFAULT because the wallkeeper's retention-floor finding is
  // right: a table nobody has bounded is a secret that outlives every restart,
  // and §5's redactor is best-effort by design. `unbounded` remains a legal
  // operator choice — the UI states plainly what it means — but the harbor must
  // never START there. `maxRows` rides along in the default even though `age`
  // ignores it: the deep-merge below carries both knobs forward, so an
  // operator who switches `mode` to `rows` gets the ceiling they were shown
  // rather than a silent default they never read.
  logRetention: { mode: "age", days: 14, maxRows: 1_000_000 },
};

// ── The log retention POLICY (§8) ───────────────────────────────────────────
//
// Validation lives HERE, in the pure seam, and not in the route — for three
// reasons, each load-bearing:
//
//   1. The route is one door; the WORKER is the other. The worker reads the
//      stored posture off its own handle, and the sweep deletes rows. A
//      validator that only the HTTP door runs would leave the deleting side
//      trusting a stored blob nobody ever checked.
//   2. Both harbors (sqlite + the mysql twin) merge through this file, so the
//      ranges cannot drift between twins the way a route-local copy would.
//   3. `updateSettings` is reachable from more places than PATCH — a restore
//      drill, a future importer. The rule belongs to the SETTING, not to one
//      caller of it.
//
// The two directions are deliberately asymmetric:
//   - INBOUND (a patch) is STRICT. An unknown key, a bad enum, a fractional or
//     non-finite number is a 400 — the wallkeeper's numbers row of the input
//     validation ledger. A sweep driven by `days: NaN` prunes on a horizon
//     nobody chose, and `DELETE` does not answer for its mistakes.
//   - STORED (the current value) is LENIENT. A row written before validation
//     existed must not wedge the door; a corrupt stored value degrades to the
//     declared default instead of making every future PATCH fail.
export const LOG_RETENTION_MODES = Object.freeze(["age", "rows", "unbounded"]);
export const LOG_RETENTION_KEYS = Object.freeze(["mode", "days", "maxRows"]);
/** Ten years of days: the age ceiling that keeps `ts` arithmetic sane. */
export const LOG_RETENTION_MIN_DAYS = 1;
export const LOG_RETENTION_MAX_DAYS = 3650;
/** One row is the floor; 50M is the ceiling the wallkeeper's range allows. */
export const LOG_RETENTION_MIN_ROWS = 1;
export const LOG_RETENTION_MAX_ROWS = 50_000_000;

function isBoundedInt(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}

/** The declared default policy, as a fresh object (never a shared reference). */
export function defaultLogRetention() {
  return { ...DEFAULT_SETTINGS.logRetention };
}

/**
 * Coerce an UNTRUSTED value into a legal policy, or null when it is not one.
 * Used for the stored side and for the worker's own defense-in-depth.
 */
export function coerceLogRetention(value, fallback = defaultLogRetention()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const out = { ...fallback };
  if (LOG_RETENTION_MODES.includes(value.mode)) out.mode = value.mode;
  if (isBoundedInt(value.days, LOG_RETENTION_MIN_DAYS, LOG_RETENTION_MAX_DAYS)) out.days = value.days;
  if (isBoundedInt(value.maxRows, LOG_RETENTION_MIN_ROWS, LOG_RETENTION_MAX_ROWS)) out.maxRows = value.maxRows;
  return out;
}

/**
 * Validate an inbound patch and deep-merge it onto `current`.
 *
 * The merge is the refuter's finding, made concrete: `updateSettings`
 * shallow-merges top-level keys, so a partial `{logRetention:{mode:'rows'}}`
 * would CLOBBER `days`/`maxRows` — and the sweep would then prune by a rule
 * the operator never chose, permanently deleting rows they expected to keep.
 * Defaults first, stored wins, patch overrides only what it names.
 *
 * @returns {{ok:true, value:object}|{ok:false, error:string}}
 */
export function resolveLogRetention(patch, current) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "logRetention must be an object" };
  }
  const unknown = Object.keys(patch).filter((k) => !LOG_RETENTION_KEYS.includes(k));
  if (unknown.length) {
    return { ok: false, error: `logRetention has unknown keys: ${unknown.join(", ")}` };
  }
  if ("mode" in patch && !LOG_RETENTION_MODES.includes(patch.mode)) {
    return { ok: false, error: `logRetention.mode must be one of: ${LOG_RETENTION_MODES.join(", ")}` };
  }
  if ("days" in patch && !isBoundedInt(patch.days, LOG_RETENTION_MIN_DAYS, LOG_RETENTION_MAX_DAYS)) {
    return {
      ok: false,
      error: `logRetention.days must be an integer between ${LOG_RETENTION_MIN_DAYS} and ${LOG_RETENTION_MAX_DAYS}`,
    };
  }
  if ("maxRows" in patch && !isBoundedInt(patch.maxRows, LOG_RETENTION_MIN_ROWS, LOG_RETENTION_MAX_ROWS)) {
    return {
      ok: false,
      error: `logRetention.maxRows must be an integer between ${LOG_RETENTION_MIN_ROWS} and ${LOG_RETENTION_MAX_ROWS}`,
    };
  }
  const base = coerceLogRetention(current);
  const value = { ...base };
  if ("mode" in patch) value.mode = patch.mode;
  if ("days" in patch) value.days = patch.days;
  if ("maxRows" in patch) value.maxRows = patch.maxRows;
  return { ok: true, value };
}


// ── the WRITE surface (Security Closure M2) ──────────────────────────────────
//
// `PATCH /api/settings` persisted whatever JSON object the caller sent. It stripped
// exactly two secrets (`password`, `mitmSudoEncrypted`) and handed the remainder to
// `updateSettings` — so an authenticated caller could plant ANY key into the settings
// blob (CWE-915, mass assignment). What makes that worth closing is not what it
// stores but what READS it: settings is a trusted store, so a planted
// `outboundProxyUrl` silently re-routes every upstream call, and any unknown key
// becomes the next reader's inheritance.
//
// The roster is DERIVED, not transcribed: `Object.keys(DEFAULT_SETTINGS)` is the
// canonical list (a new setting is declared there, or it drifts between the twins).
// The extras are the keys the dashboard genuinely persists with no default — each one
// measured in source, not guessed:
//   password            — set by the PATCH handler itself, from `newPassword`
//   ccFilterNaming      — ClaudeToolCard.js reads and writes it
//   providerThinking    — dashboard/providers/[id]/page.js writes it
//   poolGeoProbeEnabled — proxyApi.js writes it; useProxyFleet.js reads it
//   fallbackStrategy    — dashboard/settings/ (the Routing lens) writes it (account fallback order)
//   userInjectors       — dashboard/prompt-injectors/page.js writes it
//   claudeAutoPing      — ProviderLimits/index.js + providers/[id]/page.js
//   codexAutoPing       — the same pair
//   headroomCodeAware   — TokenSaverClient.js writes it; headroom/start reads it
//   headroomKompress    — the same pair
//
// A key missing from this roster is DROPPED LOUDLY by the route, never silently: a
// real setting that drifts out of the list surfaces once, in the log, instead of
// disappearing without a trace.
export const WRITABLE_SETTING_KEYS = [
  ...Object.keys(DEFAULT_SETTINGS),
  "password",
  "ccFilterNaming",
  "providerThinking",
  "poolGeoProbeEnabled",
  "fallbackStrategy",
  "userInjectors",
  "claudeAutoPing",
  "codexAutoPing",
  "headroomCodeAware",
  "headroomKompress",
];

// Merge raw settings with defaults; backward-compat for missing keys
export function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  // W3-D backfill: an existing budgetAlerts row written before the weekly
  // digest lands misses `weeklyDigestEnabled` — the shallow merge above keeps
  // the stored object verbatim, so top up missing keys from the defaults
  // (defaults first, stored values win → URLs and flags are preserved).
  if (merged.budgetAlerts && typeof merged.budgetAlerts === "object") {
    merged.budgetAlerts = { ...DEFAULT_SETTINGS.budgetAlerts, ...merged.budgetAlerts };
  }
  // M8 backfill, the same law as budgetAlerts above: a logRetention row written
  // before `maxRows` existed — or one stored as a partial object — must not
  // leave the sweep reading an undefined ceiling. Defaults first, stored wins.
  if (merged.logRetention && typeof merged.logRetention === "object") {
    merged.logRetention = { ...DEFAULT_SETTINGS.logRetention, ...merged.logRetention };
  }
  return merged;
}
