// The credential store's seam (migration 017) — one operator, password-only.
//
// The Star's decree of 2026-09-26: the dashboard's single shared password stays
// a real bcrypt credential in its own row, and the door takes ONLY that
// password. An earlier cut of this wave admitted a username; the Star withdrew
// it the same day — one occupant needs no name to be found, and a name on the
// wire is a second thing to guess and a second thing to leak.
//
// The `username` COLUMN remains in the store (it is UNIQUE, migration-pinned,
// and names the seat in the ledger's display), but it is an identity label, not
// a credential: nothing verifies against it, and the door never reads it from
// the request. This module owns the occupant's credential, so the login door,
// the status read, and the credential-change route all speak the same law
// instead of each inventing their own.
//
// ── THE TRANSITION, NAMED HONESTLY ─────────────────────────────────────────
// Before this wave the credential lived in `settings.password` (a bcrypt hash in
// a JSON document). Locking an operator out of their own harbor on upgrade would
// be the worst kind of correctness, so the transition is a SEED, not a cutover:
//
//   · ensureSeedUser() fills the empty table from whatever credential already
//     exists — the stored settings hash verbatim (already bcrypt), or
//     INITIAL_PASSWORD hashed fresh. It runs lazily, is idempotent (count-guard),
//     and does nothing when a row already exists or no credential exists at all.
//   · settings.password is KEPT as a compatibility mirror: the login door
//     accepts it once and adopts its hash into the row, and /api/settings/database
//     (whose destructive restore gate calls verifyDashboardPassword) keeps
//     working untouched. The row is authoritative; the mirror is the safety net,
//     and retiring it is a later wave with its own proof — not a silent drop.
//
// ── ONE USER, NO ROLES ─────────────────────────────────────────────────────
// DEFAULT_USERNAME seeds the single seat. There is no role column, no admin
// flag, no permission tier anywhere in this module — the door has one occupant.

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  listUsers,
  countUsers,
  createUser,
  setUserPassword,
  deleteAllUsers,
  touchUserLogin,
} from "@/lib/db/repos/usersRepo.js";

export const DEFAULT_USERNAME = "admin";

/**
 * Seed the single seat from the credential that already exists, once.
 * Idempotent: a non-empty table short-circuits. Returns the seeded row, or null
 * when there is nothing to seed (no crew AND no legacy credential) or a crew
 * already stands.
 */
export async function ensureSeedUser(settings) {
  const existing = await countUsers();
  if (existing > 0) return null;

  const legacyHash = settings?.password;
  let passwordHash = null;
  if (legacyHash) {
    // Already a bcrypt hash — adopted verbatim, never re-hashed.
    passwordHash = legacyHash;
  } else if (process.env.INITIAL_PASSWORD) {
    passwordHash = await bcrypt.hash(process.env.INITIAL_PASSWORD, 10);
  }
  if (!passwordHash) return null;

  return createUser({
    id: crypto.randomUUID(),
    username: DEFAULT_USERNAME,
    passwordHash,
  });
}

/**
 * Resolve the login target — the single seat. There is exactly one occupant,
 * so `listUsers()[0]` IS the target and no name is consulted. Kept as a
 * function (rather than reading `[0]` at the call site) so the day a second
 * seat ever exists, this is the one place that grows a lookup.
 */
export async function resolveLoginUser(users = null) {
  const all = users || (await listUsers());
  return all[0] || null;
}

/** Constant-behaviour verify against the stored hash. Never throws on bad input. */
export async function verifyUserPassword(user, password) {
  if (!user?.passwordHash || typeof password !== "string" || !password) return false;
  return bcrypt.compare(password, user.passwordHash);
}

/** Adopt an already-bcrypt legacy hash into the row (the transition's one write). */
export async function adoptLegacyHash(userId, bcryptHash) {
  if (!userId || !bcryptHash) return false;
  return setUserPassword(userId, bcryptHash);
}

/**
 * The door's single entry: seed-if-empty, then resolve the target. One place
 * owns the ordering, so the login route touches the store exactly once and
 * never has to know whether the seed has run yet — the seed is lazy, idempotent
 * and count-guarded, so a second call in the same boot is a no-op.
 */
export async function loadLoginTarget(settings) {
  let users = await listUsers();
  if (!users.length) {
    const seeded = await ensureSeedUser(settings);
    if (seeded) users = [seeded];
  }
  return resolveLoginUser(users);
}

export { setUserPassword, deleteAllUsers, touchUserLogin, countUsers };
