// mutationLedger — W0 of the Key Domain Ascension.
// ONE seam for every API-key mutation's audit row. Written by mintService
// (create/rotate/duplicate/revive/import/template) AND by the previously
// silent surfaces (revoke/pause/resume/expire/renew/edit/delete/tag ops).
//
// Actor honesty (Gate 7 F9): the ledger schema claimed CLI-vs-JWT actor
// classes but nothing wrote them. The boundary lives in dashboardGuard
// (x-vela-cli-token vs JWT cookie), so this seam accepts an explicit
// actorClass argument; routes resolve it once via resolveActorClass() and
// pass it down. The CLI routes carry their own marker via withActorMarker()
// so Next route handlers can read it from the request.
import { appendLedger } from "@/lib/db/index.js";

/**
 * Surface names are a closed vocabulary — the Audit tab filters on these.
 * Keep in sync with tests/unit/key-ledger-completeness.test.js.
 */
export const LEDGER_SURFACES = Object.freeze([
  "create", "rotate", "duplicate", "revive", "import-mint", "template-apply",
  "pause", "resume", "expire-set", "renew", "edit", "lock", "unlock",
  "revoke", "delete", "tag-add", "tag-remove", "tag-rename",
  "batch",
]);

export const ACTOR_CLASSES = Object.freeze(["dashboard", "cli", "system"]);

/** Route-local actor marker (per-request; no global state). */
const ACTOR_MARKER = Symbol.for("vela.keyMutation.actor");

/**
 * Attach an explicit actor class to a request. Called by the CLI paths
 * after CLI-token verification so downstream key-mutation routes record
 * `cli` instead of the default `dashboard`.
 */
export function withActorMarker(request, actorClass = "dashboard") {
  if (!ACTOR_CLASSES.includes(actorClass)) {
    throw new Error(`Invalid actor class: ${actorClass}`);
  }
  return { ...request, [ACTOR_MARKER]: actorClass };
}

/**
 * Resolve the actor class for a request. The dashboardGuard middleware has
 * already authenticated the call; this only decides HOW to attribute it.
 * Precedence: explicit route marker > JWT session claims > default dashboard.
 */
export function resolveActorClass(request) {
  const marked = request?.[ACTOR_MARKER];
  if (marked && ACTOR_CLASSES.includes(marked)) return marked;
  // Non-Request callers (services, sweeps) pass null → system.
  if (!request || typeof request.headers?.get !== "function") return "system";
  return "dashboard";
}

/**
 * Field-diff the PUT surface's updateData into a compact, opaque detail
 * string. Values are NEVER included for secret-bearing or free-form fields;
 * we record WHICH fields changed, not WHAT they changed to.
 */
const OPAQUE_FIELDS = new Set([
  "allowedModels", "allowedKinds", "allowedProviders", "allowedCombos",
  "allowedModes", "allowedInjectors", "ipAllowlist", "injectVarAllowlist",
]);
// Every whitelist field the PUT route accepts (route.js builds updateData
// from exactly these) — a change to that whitelist wants a mirror here.
const KNOWN_EDIT_FIELDS = [
  "name", "description", "defaultMode", "category", "isActive",
  "rateLimitRpm", "tokenBudgetDaily", "spendCapDailyCents", "budgetScope",
  "expiresAt",
  ...[...OPAQUE_FIELDS],
];

export function summarizeUpdate(updateData = {}) {
  const fields = KNOWN_EDIT_FIELDS.filter((f) => f in updateData);
  if (!fields.length) return null;
  return `fields:${fields.join(",")}`;
}

/**
 * Append ONE audit row. Wraps appendLedger with the seam's guarantees:
 * never throws (fail-open — an audit failure must not fail the mutation),
 * and stamps createdAt server-side.
 */
export async function recordMutation({
  request = null,
  actorClass = null,
  surface,
  keyId = null,
  sourceRowId = null,
  outcome,
  reason = null,
  detail = null,
}) {
  try {
    let resolved = actorClass;
    if (!resolved) resolved = resolveActorClass(request);
    if (!ACTOR_CLASSES.includes(resolved)) resolved = "dashboard";
    const composedDetail =
      reason && detail ? `${detail} | ${String(reason).slice(0, 200)}`
      : reason ? String(reason).slice(0, 200)
      : detail;
    return await appendLedger({
      surface: LEDGER_SURFACES.includes(surface) ? surface : "edit",
      keyId,
      sourceRowId,
      outcome,
      actorClass: resolved,
      detail: composedDetail != null ? String(composedDetail).slice(0, 500) : null,
    });
  } catch (error) {
    console.error("[key-ledger] failed to record mutation:", error?.message || error);
    return null;
  }
}

/**
 * Compute which lifecycle bucket a given field change belongs to, so the
 * PUT route can name its surfaces honestly instead of a single catch-all.
 */
export function classifyPutSurface(updateData = {}) {
  if ("isActive" in updateData) {
    return updateData.isActive === false ? "pause" : "resume";
  }
  if ("expiresAt" in updateData) return "expire-set";
  return "edit";
}
