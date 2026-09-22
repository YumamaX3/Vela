// Shared laws for the key API surface — the list, stats, bulk, export and
// import routes all import from here, so five routes cannot drift into five
// dialects of the same three laws:
//
//   1. the posture read  — active / paused / expired / expiring
//   2. the attention law — what a key's posture owes the operator's eye
//   3. the redaction law — what may leave the harbor as a file
//
// Pure where it can be (the posture math, the attention reasons, the
// redaction), so the dashboard and the routes agree by construction rather
// than by coincidence.

/** The export envelope's identity — a file that names what it is, so an
 *  importer can refuse the wrong document instead of half-applying it. */
export const EXPORT_ENVELOPE = "vela-keys";
export const EXPORT_VERSION = 1;

/** A silent expiry is a lockout nobody scheduled, so an expiry inside the next
 *  seven days is called out early rather than discovered at the door. */
export const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

/** The key's posture, DERIVED, never stored.
 *
 *  Order matters: the pause is the operator's own act and is the honest first
 *  answer about a key they deliberately switched off (an expired-but-paused
 *  key reads "paused", not "expired"). Everything else falls to the expiry
 *  arithmetic, and a key with no expiry and no pause is simply active. */
export function postureOf(key, now = Date.now()) {
  if (key?.isActive === false) return "paused";
  const t = key?.expiresAt ? Date.parse(key.expiresAt) : NaN;
  if (Number.isFinite(t)) {
    if (t <= now) return "expired";
    if (t - now <= EXPIRING_SOON_MS) return "expiring";
  }
  return "active";
}

/** True when the key is narrowed at all — by model scope or by the ACL triple.
 *  An unnarrowed key reaches every provider the harbor can dial, which is the
 *  single most useful fact the operator can be told about it. */
export function isScoped(key) {
  const nonEmpty = (v) => Array.isArray(v) && v.length > 0;
  return (
    nonEmpty(key?.allowedModels) ||
    nonEmpty(key?.allowedKinds) ||
    nonEmpty(key?.allowedProviders) ||
    nonEmpty(key?.allowedCombos)
  );
}

/** True when any spend/rate/IP ceiling is set. An active, unscoped, unlimited
 *  key is the shape worth a second look. */
export function isLimited(key) {
  return (
    key?.rateLimitRpm != null ||
    key?.tokenBudgetDaily != null ||
    key?.spendCapDailyCents != null ||
    (Array.isArray(key?.ipAllowlist) && key.ipAllowlist.length > 0)
  );
}

/** Reasons this key deserves the operator's attention, most severe first.
 *  An empty list means the key is unremarkable — the common case, which must
 *  stay quiet or the signal is worthless. */
export function attentionFor(key, posture, { usage = null, now = Date.now() } = {}) {
  const reasons = [];
  if (posture === "expired") reasons.push("expired");
  if (posture === "expiring") reasons.push("expires within 7 days");
  if (posture === "paused") reasons.push("paused");

  // Only active keys are judged on their posture-at-rest; a paused or expired
  // key has already been called out for the thing that matters about it.
  if (posture === "active") {
    if (!isScoped(key)) reasons.push("unrestricted scope");
    if (!isLimited(key)) reasons.push("no limits");
    if (!key?.lastUsedAt) {
      const createdAt = key?.createdAt ? Date.parse(key.createdAt) : NaN;
      if (Number.isFinite(createdAt) && now - createdAt > EXPIRING_SOON_MS) {
        reasons.push("never used");
      }
    }
    if (usage && usage.requests === 0 && key?.lastUsedAt) reasons.push("no traffic in window");
  }
  return reasons;
}

/** The redaction law.
 *
 *  Export is a FILE that leaves the harbor, so this enumerates the fields it
 *  knows rather than trusting `rowToPublic`'s projection — a column added to
 *  the row later cannot ride out by accident. There is no full key to strip
 *  (hash-at-rest, show-once: the plaintext is never server-side after the 201
 *  response), and `keyHash`/`key` are named here so the discipline reads as
 *  deliberate rather than lucky. `keyPrefix` and `lastUsedAt` are deliberate:
 *  they are what makes an exported fleet auditable at all. */
export function redactKeyForExport(key) {
  return {
    name: key?.name ?? null,
    description: key?.description ?? null,
    category: key?.category ?? null,
    keyPrefix: key?.keyPrefix ?? null,
    isActive: key?.isActive !== false,
    createdAt: key?.createdAt ?? null,
    lastUsedAt: key?.lastUsedAt ?? null,
    expiresAt: key?.expiresAt ?? null,
    allowedModels: Array.isArray(key?.allowedModels) ? key.allowedModels : null,
    allowedKinds: Array.isArray(key?.allowedKinds) ? key.allowedKinds : null,
    allowedProviders: Array.isArray(key?.allowedProviders) ? key.allowedProviders : null,
    allowedCombos: Array.isArray(key?.allowedCombos) ? key.allowedCombos : null,
    rateLimitRpm: key?.rateLimitRpm ?? null,
    tokenBudgetDaily: key?.tokenBudgetDaily ?? null,
    spendCapDailyCents: key?.spendCapDailyCents ?? null,
    budgetScope: key?.budgetScope ?? null,
    ipAllowlist: Array.isArray(key?.ipAllowlist) ? key.ipAllowlist : null,
  };
}

/** Body reader that answers `{}` for an empty or malformed body, so a route
 *  reaches its own honest 400 instead of throwing into a generic 500. */
export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** The next free "<base> (2)", "<base> (3)", … — the shape a key name grows
 *  when an import would otherwise collide, hoisted here so the dry-run plan and
 *  the real apply name the same key the same way (a plan that promised
 *  "<base> (2)" and a write that produced "<base>-copy" would be a lie told at
 *  the one moment the operator is deciding whether to trust it). */
export function uniqueName(taken, base, limit = 100) {
  if (!taken.has(base)) return base;
  for (let i = 2; i <= limit; i += 1) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}
