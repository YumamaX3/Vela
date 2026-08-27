/**
 * lifecycleOf — the shared 6-state key lifecycle machine (Endpoint
 * Observatory W1d, Shorekeeper-Sealed Plan §1.3).
 *
 * Pure + deterministic: state derives ONLY from the key row + the injected
 * clock (serverNow). Date.now() is BANNED from lifecycle paths — the caller
 * passes the server-stamped now (clock-pinning rule, Covenant P11).
 *
 * Precedence ladder (documented, tested): deleted > revoked > expired >
 * grace > pending-reveal > active. When multiple predicates hold, the
 * highest rung wins.
 *
 *   deleted        — soft-tombstone (deletedAt set), hidden from default views
 *   revoked        — operator-revoked, row stays VISIBLE (deletedAt NULL,
 *                    hash purged) — the revoke/delete split (plan §1.3)
 *   expired        — past expiresAt
 *   grace          — rotation grace window: old token still resolvable via
 *                    rotationPrevHash (S4 repair — the 72h grace now works)
 *   pending-reveal — minted, plaintext not yet collected
 *   active         — serving traffic
 *
 * rotation_grace keys fold into the ACTIVE count on the pill row (they ARE
 * active — the old token still authenticates) while carrying their own amber
 * badge in rows. This fold is deliberate, not accidental.
 */

export const LIFECYCLE = Object.freeze({
  DELETED: "deleted",
  REVOKED: "revoked",
  EXPIRED: "expired",
  GRACE: "grace",
  PENDING_REVEAL: "pending-reveal",
  ACTIVE: "active",
});

export const LIFECYCLE_META = Object.freeze({
  [LIFECYCLE.DELETED]: { label: "Deleted", tone: "muted" },
  [LIFECYCLE.REVOKED]: { label: "Revoked", tone: "red" },
  [LIFECYCLE.EXPIRED]: { label: "Expired", tone: "amber" },
  [LIFECYCLE.GRACE]: { label: "Rotation grace", tone: "amber" },
  [LIFECYCLE.PENDING_REVEAL]: { label: "Awaiting reveal", tone: "blue" },
  [LIFECYCLE.ACTIVE]: { label: "Active", tone: "green" },
});

/** tsOf — parse an ISO string to epoch ms, or null if absent/invalid. */
export function tsOf(v) {
  if (v == null) return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Derive a key's lifecycle state. Pure — no Date.now(), no fs, no fetch.
 * @param {object} key the key row (public projection is fine)
 * @param {number|string} [now] server-stamped clock (ms or ISO). Required.
 * @returns {string} one of LIFECYCLE.* — or null for garbage input
 */
export function lifecycleOf(key, now) {
  if (!key || typeof key !== "object") return null;
  const nowMs = tsOf(now);
  if (nowMs == null) return LIFECYCLE.ACTIVE; // no clock → fail-open, never crash

  // Rung 1 — deleted beats all.
  if (key.deletedAt) return LIFECYCLE.DELETED;

  // Rung 2 — revoked: row visible (deletedAt NULL), hash purged, no
  // predecessor identity. A rotated-predecessor that has lost its grace is
  // also revoked (it is a tombstone of rotation lineage).
  const hashDead = key.keyHash == null && key.isActive === 0;
  if (hashDead && !key.rotationPrevHash) return LIFECYCLE.REVOKED;

  // Rung 3 — expired.
  const exp = tsOf(key.expiresAt);
  if (exp != null && exp <= nowMs) return LIFECYCLE.EXPIRED;

  // Rung 4 — rotation grace: this row carries rotationPrevHash (it is the
  // successor) or rotatedFrom + graceUntil (it is the predecessor whose old
  // token still authenticates inside the window).
  const graceUntil = tsOf(key.rotationGraceUntil);
  if (graceUntil != null && graceUntil > nowMs) return LIFECYCLE.GRACE;

  // Rung 5 — pending reveal: minted, hash present, never collected.
  if (key.keyHash != null && key.keyPrefix && key.revealPending === true) {
    return LIFECYCLE.PENDING_REVEAL;
  }

  // Rung 6 — active.
  if (key.isActive !== 0) return LIFECYCLE.ACTIVE;

  // isActive = 0 with hash still present → paused-class (revoke keeps the
  // hash purged; a plain pause keeps it). Fail-open to active-family.
  return LIFECYCLE.REVOKED;
}

/** Count lifecycle states over a fleet — feeds the pill row + distribution bar. */
export function lifecycleCounts(keys, now) {
  const counts = {
    [LIFECYCLE.DELETED]: 0,
    [LIFECYCLE.REVOKED]: 0,
    [LIFECYCLE.EXPIRED]: 0,
    [LIFECYCLE.GRACE]: 0,
    [LIFECYCLE.PENDING_REVEAL]: 0,
    [LIFECYCLE.ACTIVE]: 0,
  };
  for (const k of keys || []) {
    const st = lifecycleOf(k, now);
    if (st && st in counts) counts[st] += 1;
  }
  return counts;
}
