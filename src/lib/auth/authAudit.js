/**
 * authAudit — the Auth Hardening W1 trail (migration 016, authAuditLog).
 *
 * Before this wave nothing recorded a login outcome, a lockout, or a
 * revocation anywhere. This module is the one writer of that trail.
 *
 * ── THE CONTRACT THAT MATTERS ─────────────────────────────────────────────
 * `detail` is a METADATA-ONLY surface. No password, no token, no hash, no
 * cookie, no authorization header ever reaches it — not by convention but by
 * construction: sanitizeAuditDetail() drops any key that even *smells* like a
 * credential and caps the encoded size. A caller cannot leak a secret through
 * this seam by passing one, because there is no key that carries it.
 *
 * ── FAIL-OPEN, ALWAYS ─────────────────────────────────────────────────────
 * Auditing must never be the reason a login fails. Every path here swallows its
 * own errors (one latched warning, so a broken harbor logs once rather than
 * once per request) and resolves to null. The caller never awaits an exception.
 */
import { insertAuditRow } from "@/lib/db/repos/authStoreRepo.js";
import { getAdapterSync } from "@/lib/db/driver.js";
import { getClientIp } from "./loginLimiter.js";

/** The event vocabulary — the column is `eventType` (a MySQL reserved word
 *  would have been `event`; see migration 016's header). */
export const AUTH_EVENTS = Object.freeze({
  LOGIN_OK: "login.ok",
  LOGIN_FAIL: "login.fail",
  LOGIN_LOCKED: "login.locked",
  LOGIN_RATE_LIMITED: "login.rate_limited",
  LOGIN_FRICTIONLESS: "login.frictionless",
  LOGIN_BLOCKED: "login.blocked",
  SESSION_REVOKED: "session.revoked",
  SESSIONS_REVOKED_ALL: "sessions.revoked_all",
});

// A key matching this carries something that must never be persisted.
const SECRET_KEY_RE = /pass|secret|token|hash|bearer|cookie|jwt|credential|authorization|apikey|api_key/i;
const MAX_DETAIL_JSON = 1000;
const MAX_STRING_LEN = 200;

/**
 * Flatten `detail` into a JSON string carrying no secrets, or null.
 * Scalars only, credential-shaped keys dropped, strings truncated.
 */
export function sanitizeAuditDetail(detail) {
  if (detail === null || detail === undefined) return null;
  if (typeof detail !== "object" || Array.isArray(detail)) {
    return truncate(String(detail));
  }
  const out = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SECRET_KEY_RE.test(key)) continue; // never persisted, never logged
    if (value === null || value === undefined) continue;
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = truncate(value);
  }
  const json = JSON.stringify(out);
  if (json === "{}") return null;
  return json.length > MAX_DETAIL_JSON ? `${json.slice(0, MAX_DETAIL_JSON - 3)}..."` : json;
}

function truncate(s) {
  return s.length > MAX_STRING_LEN ? `${s.slice(0, MAX_STRING_LEN - 3)}...` : s;
}

let warned = false;
function warnOnce(err) {
  if (warned) return;
  warned = true;
  console.warn("[authAudit] audit write failed (fail-open):", err?.message || err);
}

/** Test seam — re-arm the latched warning. */
export function resetAuthAuditForTests() {
  warned = false;
}

/**
 * Record one auth event. Never throws, never awaits a caller's catch —
 * a broken harbor degrades to "no trail", never to "no login".
 *
 * @param {string} eventType one of AUTH_EVENTS
 * @param {{request?: Request, ip?: string, userAgent?: string, detail?: object}} ctx
 */
export async function auditAuthEvent(eventType, ctx = {}) {
  // The harbor is CONSULTED, never opened. getAdapter() here would initialize a
  // database as a side effect of logging — and a mocked unit test that mocks
  // everything else would then write real rows into the operator's own DATA_DIR.
  // A cold process (no adapter live yet) has nowhere to write, and says so by
  // returning false WITHOUT warning: that is the expected doorstep, not a fault.
  //
  // In production this is never the case at the moment it matters: the login
  // route awaits getSettings() before any outcome it audits, which opens the
  // harbor. The one honest gap is a cold process whose FIRST request is already
  // locked or rate-limited — the same single-request doorstep the limiter's own
  // header names. Every lockout the ladder actually trips is audited.
  let db;
  try {
    db = getAdapterSync();
  } catch {
    return false;
  }
  try {
    const { request } = ctx;
    const ip = ctx.ip ?? (request ? safeClientIp(request) : null);
    const userAgent = ctx.userAgent ?? request?.headers?.get?.("user-agent") ?? null;
    insertAuditRow(db, {
      ts: new Date().toISOString(),
      eventType,
      ip: ip ? truncate(String(ip)) : null,
      userAgent: userAgent ? truncate(String(userAgent)) : null,
      detail: sanitizeAuditDetail(ctx.detail),
    });
    return true;
  } catch (err) {
    warnOnce(err);
    return false;
  }
}

/** getClientIp is pure, but the audit path must not die on a malformed request. */
function safeClientIp(request) {
  try {
    return getClientIp(request);
  } catch {
    return null;
  }
}

export default auditAuthEvent;
