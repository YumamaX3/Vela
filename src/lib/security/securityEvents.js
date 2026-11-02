// THE AUDIT DOORS — the fail-open seam every hot path writes through.
//
// Two rooms sit behind this file (migration 030): the security LOG (an
// append-only ledger) and the trust INBOX (the operator's unread bell). This
// module is the only thing the gateway's hot paths call — the key routes, the
// key gate, the guardrail pipeline — so none of them ever imports the DB
// adapter directly (the contract census at tests/unit/db-contract-census.test.js
// keeps that law).
//
// THE FAIL-OPEN LAW, and why it is shaped this way:
//
//   A write failure here logs a warning and returns false. It NEVER throws.
//   An audit line is worth a glance, not an outage: a full disk or a locked
//   table must never turn "this request is rate-limited" into a 500, and must
//   never turn "this key was created" into a failed mint. So recordSecurityEvent
//   resolves to a boolean and no caller has to wrap it.
//
// WHAT IS RECORDED, AND WHAT NEVER IS (detail metadata only, by contract):
//   • a keyId (an identifier) and the masked keyPrefix — never a full key
//   • a verdict code, a provider/model name, a limit and the figure crossed
//   • an IP as stamped by the gate's own resolveClientIp — never a header
//   No credential, no Authorization value, no prompt text, no matched value.
//
// HOT-PATH COALESCING: a rate- or budget-denied key can be retried in a loop,
// and one ledger line per retry would bury the operator under thousands of
// identical rows inside a minute. Security denials coalesce per (keyId, kind)
// for a short window — the ledger says "this key hit this wall, and kept
// hitting it", which is the honest summary. Discrete acts (key.created,
// key.revoked, guardrail.block) are NOT coalesced: each one is a distinct
// event whose count matters.
import { appendSecurityEvent } from "@/lib/db/repos/securityLogRepo.js";
import { appendTrustEvent } from "@/lib/db/repos/trustEventsRepo.js";
import * as log from "@/sse/utils/logger.js";

/** Denial kinds that coalesce on the hot path (see HOT-PATH COALESCING). */
const COALESCED_KINDS = new Set(["rate.limited", "budget.exceeded"]);
const COALESCE_WINDOW_MS = 60_000;
const COALESCE_MAX_KEYS = 5_000;

// Per-process module state survives Next dev hot-reload via a global singleton
// (the keyGate stamp-log precedent): a reload must not reset the window and
// flush a fresh line for every in-flight retry.
function coalesceMap() {
  if (!global.__velaSecurityCoalesce) global.__velaSecurityCoalesce = new Map();
  return global.__velaSecurityCoalesce;
}

function shouldEmit(keyId, kind, detail, now) {
  if (!COALESCED_KINDS.has(kind)) return true;
  const map = coalesceMap();
  const key = `${keyId ?? "-"}|${kind}|${detail?.code ?? ""}|${detail?.dimension ?? detail?.window ?? ""}`;
  const last = map.get(key);
  if (last != null && now - last < COALESCE_WINDOW_MS) return false;
  if (map.size >= COALESCE_MAX_KEYS && !map.has(key)) {
    // Bounded sweep — drop the oldest stamps rather than grow without limit.
    const oldest = map.keys().next().value;
    if (oldest != null) map.delete(oldest);
  }
  map.set(key, now);
  return true;
}

/** Test seam — clears the coalescing window between cases. */
export function __resetSecurityCoalesce() {
  coalesceMap().clear();
}

/**
 * Append one security-log line. Fail-open: returns true on a written line,
 * false when the write could not be made — never throws.
 *
 * @param {{keyId?:string|null, kind:string, detail?:object|null, ip?:string|null}} event
 * @returns {Promise<boolean>}
 */
export async function recordSecurityEvent({ keyId = null, kind, detail = null, ip = null } = {}) {
  try {
    if (!kind) return false;
    if (!shouldEmit(keyId, kind, detail, Date.now())) return true; // coalesced — already recorded
    await appendSecurityEvent({ keyId, kind, detail, ip });
    return true;
  } catch (err) {
    log.warn?.("SECURITY", `security log write failed (${kind}): ${err?.message ?? err}`);
    return false;
  }
}

/**
 * Append one trust-inbox notice. Fail-open, same law as recordSecurityEvent.
 *
 * @param {{kind:string, title:string, detail?:object|null}} event
 * @returns {Promise<boolean>}
 */
export async function recordTrustEvent({ kind, title, detail = null } = {}) {
  try {
    if (!kind || !title) return false;
    await appendTrustEvent({ kind, title, detail });
    return true;
  } catch (err) {
    log.warn?.("SECURITY", `trust inbox write failed (${kind}): ${err?.message ?? err}`);
    return false;
  }
}

/**
 * The pairing the wiring uses: one act, recorded on BOTH surfaces when it
 * deserves the bell. The ledger line and the inbox notice are independent
 * fail-open writes — one failing never suppresses the other.
 *
 * @returns {Promise<{logged:boolean, noticed:boolean}>}
 */
export async function recordSecurityAndTrust(
  { keyId = null, kind, detail = null, ip = null },
  { trustKind, title, trustDetail = null } = {}
) {
  const [logged, noticed] = await Promise.all([
    recordSecurityEvent({ keyId, kind, detail, ip }),
    trustKind && title ? recordTrustEvent({ kind: trustKind, title, detail: trustDetail ?? detail }) : Promise.resolve(false),
  ]);
  return { logged, noticed };
}
