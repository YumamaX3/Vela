// The Twin Harbors posture seam (Storage Covenant, plans/storage-covenant.md).
// Resolves VELA_DB_MODE once per process; Wave A ships only the sqlite harbor,
// so repo facades are pure re-exports. From Wave A7 the mysql/mirror harbors
// bind behind the SAME 74-function contract through this module.

const MODES = ["sqlite", "mysql", "mirror"];

export function getDbMode() {
  const raw = (process.env.VELA_DB_MODE || "sqlite").toLowerCase();
  if (!MODES.includes(raw)) {
    throw new Error(`[DB] unknown VELA_DB_MODE "${raw}" — expected sqlite|mysql|mirror`);
  }
  return raw;
}

// ─── Wave A6 — the fail-loud boot gate ───────────────────────────────────
// Plan: plans/storage-covenant.md boot matrix (line 364):
//   mysql | mysql2 pool | unreachable → "fail-loud boot refusal — never
//   silent downgrade". The mysql/mirror repos land in Waves A7–A9, so A6
// refuses the mysql posture at the seam itself (loud, named) and validates
// reachability so the boot-refusal test can prove both halves.

/** Validate + probe the mysql URL before anything binds to it. Throws loud:
 *  missing URL, malformed URL, or unreachable server. */
export async function assertMysqlReachable() {
  const url = process.env.VELA_MYSQL_URL;
  if (!url || !url.trim()) {
    throw new Error(`[DB] VELA_DB_MODE="${getDbMode()}" requires VELA_MYSQL_URL (mysql://user:pass@host:3306/vela) — refusing to boot without it`);
  }
  const { probeMysqlUrl } = await import("../mysql/pool.js");
  await probeMysqlUrl(url.trim()); // throws loud on any connection failure
}

/** The A6 refusal — exportDb/importDb live in repos/backupRepo.js (Wave B1
 *  harbor-home, plan line 420) and call this gate before dispatching; under a
 *  mysql/mirror posture they refuse LOUD rather than silently exporting the
 *  wrong engine. Repo-level dispatch lives in bindFacade() below. */
export async function assertHarborBound() {
  const mode = getDbMode();
  if (mode === "sqlite") return; // today's harbor — binds verbatim
  if (mode === "mysql") {
    // Reachability is validated so the boot matrix can prove the LOUD half
    // (unreachable) separately from the repos-not-yet-bound half.
    await assertMysqlReachable();
    throw new Error(
      `[DB] VELA_DB_MODE=mysql — the barrel export/import functions land with the Storage Covenant backup engine (Wave B) — boot refusal (fail loud, never silent downgrade)`
    );
  }
  // mirror: Wave C — primary sqlite + pump. Not yet forged.
  throw new Error(
    `[DB] VELA_DB_MODE=mirror binds in Storage Covenant Wave C — boot refusal (fail loud, never silent downgrade)`
  );
}

// ─── Wave A7 — facade dispatch ────────────────────────────────────────────
// The config-wave repos are bound through bindFacade(): sqlite re-exports the
// harbor verbatim; mysql imports the twin. Every name NOT yet forged in the
// mysql harbor fails LOUD at call time (never silently downgrades) until its
// wave lands (A8 security, A9 usage).
//
// The mysql module path is passed as a LOADER function from each facade (a
// static `import("../mysql/…")` call site) — never built as a template string
// here, so bundlers can analyze the target module.

/** The A7 config-wave surface — the repos/mysql config twins cover these. */
const CONFIG_WAVE_NAMES = new Set([
  // settingsRepo
  "mergeWithDefaults", "getSettings", "updateSettings", "isCloudEnabled", "getCloudUrl", "exportSettings",
  // connectionsRepo
  "getProviderConnections", "getProviderConnectionById", "createProviderConnection",
  "updateProviderConnection", "deleteProviderConnection", "deleteProviderConnectionsByProvider",
  "reorderProviderConnections", "cleanupProviderConnections",
  // nodesRepo
  "getProviderNodes", "getProviderNodeById", "createProviderNode", "updateProviderNode", "deleteProviderNode",
  // proxyPoolsRepo
  "getProxyPools", "getProxyPoolById", "createProxyPool", "updateProxyPool", "deleteProxyPool",
  // combosRepo
  "getCombos", "getComboById", "getComboByName", "createCombo", "updateCombo", "deleteCombo",
  // aliasRepo
  "getModelAliases", "setModelAlias", "deleteModelAlias", "getCustomModels",
  "addCustomModel", "deleteCustomModel", "getMitmAlias", "setMitmAliasAll",
]);

/** The A8 security-wave surface — apiKeys (hash-at-rest, rotation,
 *  soft-delete), disabledModels, pricing, requestDetails. */
const SECURITY_WAVE_NAMES = new Set([
  // apiKeysRepo
  "sanitizeCategory", "getApiKeys", "getApiKeyById", "createApiKey", "updateApiKey",
  "deleteApiKey", "resolveKey", "validateApiKey", "ensureInternalKey",
  // disabledModelsRepo
  "getDisabledModels", "getDisabledByProvider", "disableModels", "enableModels",
  // pricingRepo
  "getPricing", "getPricingForModel", "updatePricing", "resetPricing", "resetAllPricing",
  "replaceSyncedPricing", "clearSyncedPricing", "getSyncedPricing",
  // requestDetailsRepo
  "saveRequestDetail", "getRequestDetails", "getDistinctProviders", "getRequestDetailById",
]);

/** The A9 usage-wave surface — the full usageRepo contract. */
const USAGE_WAVE_NAMES = new Set([
  "trackPendingRequest", "getActiveRequests", "saveRequestUsage", "getUsageHistory",
  "getUsageStats", "getKeyUsageStats", "touchKeyLastUsed", "getUsageDailySince",
  "getChartData", "appendRequestLog", "getRecentLogs",
]);

/** Bind a facade barrel to its posture's harbor.
 *  @param sqliteRepo the sqlite harbor module (verbatim binding under sqlite)
 *  @param mysqlLoader `() => import("../mysql/<repo>.js")` — static call site */
export function bindFacade(sqliteRepo, mysqlLoader) {
  if (getDbMode() === "sqlite") return sqliteRepo; // verbatim — sync fns stay sync
  // mysql posture: wrap every bound-wave name; everything else refuses loud.
  const bound = {};
  for (const [name, fn] of Object.entries(sqliteRepo)) {
    if (typeof fn !== "function") { bound[name] = fn; continue; }
    if (!CONFIG_WAVE_NAMES.has(name) && !SECURITY_WAVE_NAMES.has(name) && !USAGE_WAVE_NAMES.has(name)) {
      bound[name] = () => {
        throw new Error(`[DB] VELA_DB_MODE=mysql — repo fn "${name}" lands in a later Storage Covenant wave (Wave C mirror). Boot refusal (fail loud, never silent downgrade).`);
      };
      continue;
    }
    bound[name] = async (...args) => {
      const mod = await mysqlLoader();
      if (typeof mod[name] !== "function") {
        throw new Error(`[DB] mysql twin is missing "${name}" — the repo twin is incomplete`);
      }
      return mod[name](...args);
    };
  }
  return bound;
}
