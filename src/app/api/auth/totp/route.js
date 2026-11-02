import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession, AUTH_COOKIE_NAME } from "@/lib/auth/dashboardSession";
import { getUserById } from "@/lib/auth/users.js";
import { updateUser } from "@/lib/db/repos/usersRepo.js";
import { generateSecret, verifyTotp, otpauthUri } from "@/lib/auth/totp.js";
import { mintBackupCodes, verifyBackupCode, countBackupCodes } from "@/lib/auth/backupCodes.js";
import { TOTP_REFUSED_MESSAGE } from "@/lib/auth/loginMessages.js";
import * as log from "@/sse/utils/logger.js";

// POST /api/auth/totp — the second lock's door, managed from inside.
//
// THE SESSION IS THE DOOR. Every action here changes how the operator logs in,
// so each one requires an authenticated dashboard session, read from the cookie
// exactly as /api/auth/status reads it. No session → 401, never a hint of who
// holds the lock.
//
// ── THE THREE ACTS, AND WHY ENROLLMENT IS TWO OF THEM ─────────────────────
//   enroll   — mint a secret, store it, and set NOTHING else. `totpEnabled`
//              stays absent, so the row is INERT until proven: a secret that
//              was minted but never scanned changes no login. The response
//              carries the secret and its otpauth:// URI, which the operator's
//              own app reads — no external QR service, ever (env-free promise).
//   activate — verify one code against the stored secret, THEN flip
//              `totpEnabled` to 1 and mint the backup-code set. This is where
//              2FA becomes real for the login door.
//   disable  — prove it is the operator (a live code OR a backup code), then
//              clear all three columns. Fail-closed on a wrong code: a stolen
//              session must not be able to strip the second lock without a
//              factor it does not hold.
//
// ── THE PLAINTEXT CODES: SHOWN ONE TIME, ONCE ─────────────────────────────
// mintBackupCodes() hands back plaintext AND hashes. The hashes go to the row;
// the plaintext leaves in THIS response and is never stored, never logged, never
// returned again. Regeneration re-mints the set; the old sheet is dead.
//
// ── WHAT LEAVES THE BUILDING ──────────────────────────────────────────────
// The user row carries `totpSecret` and `backupCodes`; neither is ever echoed
// except where deliberately (the enroll secret, the one-time code list). The
// status answer is booleans and a count only — never the bare lock inventory.

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) },
  });
}

/** The occupant behind the cookie — by id, the way the claims carry it. */
async function currentUser() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  if (!session) return null;
  // The session names the seat by id when it was minted; a legacy token may
  // carry only a username. getUserById is the reader the row already exports.
  const byId = session.userId ? await getUserById(session.userId) : null;
  if (byId) return { user: byId, session };
  // A session minted before the id claim rode along still belongs to the one
  // occupant; resolve by name only when that is all the token carries.
  if (session.username) {
    const { getUserByUsername } = await import("@/lib/auth/users.js");
    const byName = await getUserByUsername(session.username);
    if (byName) return { user: byName, session };
  }
  return null;
}

/** A code that proves the operator: a live TOTP step, or one unburned backup code. */
async function proveCode(user, code) {
  if (user.totpSecret) {
    const totp = verifyTotp(user.totpSecret, code);
    if (totp.ok) return { ok: true, via: "totp" };
  }
  const backup = verifyBackupCode(user.backupCodes, code);
  if (backup.ok) return { ok: true, via: "backup", hashes: backup.hashes };
  return { ok: false };
}

const STRICT_LITERAL_1 = 1;

/**
 * GET — what the Settings card reads to draw the right state. Booleans and a
 * count only: never the secret, never a digest, never a code. A row that is
 * half-enrolled (secret minted, flag unset) reports `enabled:false, enrolled:
 * true` so the card knows to ask for the activating code rather than re-mint.
 */
export async function GET() {
  try {
    const current = await currentUser();
    if (!current) return json({ error: "Not authenticated" }, { status: 401 });
    const { user } = current;
    return json({
      enabled: user.totpEnabled === STRICT_LITERAL_1,
      enrolled: Boolean(user.totpSecret),
      backupCodesRemaining: countBackupCodes(user.backupCodes),
    });
  } catch (error) {
    log.error("AUTH", "totp status read failure:", error?.message || error);
    return json({ error: "Two-factor operation failed. Check the server logs." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const current = await currentUser();
    if (!current) {
      return json({ error: "Not authenticated" }, { status: 401 });
    }
    const { user } = current;

    let body = {};
    try {
      body = (await request.json()) || {};
    } catch {
      body = {};
    }
    const action = String(body.action || "");
    const code = typeof body.code === "string" ? body.code : "";

    // ── enroll ────────────────────────────────────────────────────────────
    if (action === "enroll") {
      // An ACTIVE second lock is never silently replaced: re-enrolling over a
      // live enrollment would let a stolen session rekey the factor to itself.
      // The honest path is disable first (which demands a code), or regenerate.
      if (user.totpEnabled === STRICT_LITERAL_1) {
        return json({ error: "Two-factor is already enabled. Disable it before enrolling a new device." }, { status: 409 });
      }
      const secret = generateSecret();
      // Stored, but NOT enabled: a half-enrolled row is inert by design.
      await updateUser(user.id, { totpSecret: secret, totpEnabled: null, backupCodes: null });
      const uri = otpauthUri({ secret, account: user.username || "admin", issuer: "Vela" });
      return json({ secret, uri });
    }

    // ── activate ──────────────────────────────────────────────────────────
    if (action === "activate") {
      if (!user.totpSecret) {
        return json({ error: "Enroll first", totpRequired: false }, { status: 400 });
      }
      const check = verifyTotp(user.totpSecret, code);
      if (!check.ok) {
        return json({ error: TOTP_REFUSED_MESSAGE, totpRequired: true }, { status: 401 });
      }
      const set = mintBackupCodes();
      await updateUser(user.id, {
        totpEnabled: STRICT_LITERAL_1,
        backupCodes: JSON.stringify(set.hashes),
      });
      // The plaintext set leaves exactly once, here.
      return json({ ok: true, backupCodes: set.codes });
    }

    // ── disable ───────────────────────────────────────────────────────────
    if (action === "disable") {
      // A row that is already off is a no-op, not an error — but it still must
      // have a session, which the check above guarantees.
      if (user.totpEnabled !== STRICT_LITERAL_1) {
        return json({ ok: true, enabled: false });
      }
      const proof = await proveCode(user, code);
      if (!proof.ok) {
        return json({ error: TOTP_REFUSED_MESSAGE, totpRequired: true }, { status: 401 });
      }
      await updateUser(user.id, { totpEnabled: 0, totpSecret: null, backupCodes: null });
      return json({ ok: true, enabled: false });
    }

    return json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    // Same hygiene as the login door: an internal string is a map of the
    // harbor to whoever probed it. The detail goes to the log.
    log.error("AUTH", "totp enrollment failure:", error?.message || error);
    return json({ error: "Two-factor operation failed. Check the server logs." }, { status: 500 });
  }
}
