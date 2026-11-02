import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession, AUTH_COOKIE_NAME } from "@/lib/auth/dashboardSession";
import { getUserById } from "@/lib/auth/users.js";
import { updateUser } from "@/lib/db/repos/usersRepo.js";
import { verifyTotp } from "@/lib/auth/totp.js";
import { mintBackupCodes, verifyBackupCode } from "@/lib/auth/backupCodes.js";
import { TOTP_REFUSED_MESSAGE } from "@/lib/auth/loginMessages.js";
import * as log from "@/sse/utils/logger.js";

// POST /api/auth/totp/backup-codes — the emergency key ring, re-minted.
//
// WHY A CODE IS THE PRICE: this response carries ten fresh PLAINTEXT codes and
// the moment it lands the old sheet is dead. Minting them behind nothing but a
// session would let a stolen session strand the operator with a sheet they never
// saw — the most expensive way to fail. So the caller proves a factor they
// HOLD: a live TOTP code, or one of the CURRENT backup codes (regenerating with
// the sheet that is about to die is the one time it may still be spent). Either
// burns nothing extra — the burn that matters is the SET being replaced.
//
// WHAT LEAVES: the new plaintext set, once. The row receives only the digests.
// Nothing here is ever stored in plaintext, and a second read cannot recover it.
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const STRICT_LITERAL_1 = 1;

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...(init.headers || {}) },
  });
}

async function currentUser() {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  if (!session) return null;
  const byId = session.userId ? await getUserById(session.userId) : null;
  if (byId) return byId;
  if (session.username) {
    const { getUserByUsername } = await import("@/lib/auth/users.js");
    return (await getUserByUsername(session.username)) || null;
  }
  return null;
}

export async function POST(request) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Not authenticated" }, { status: 401 });

    let body = {};
    try {
      body = (await request.json()) || {};
    } catch {
      body = {};
    }
    if (String(body.action || "") !== "regenerate") {
      return json({ error: "Unknown action" }, { status: 400 });
    }
    if (user.totpEnabled !== STRICT_LITERAL_1) {
      return json({ error: "Two-factor is not enabled" }, { status: 409 });
    }

    const code = typeof body.code === "string" ? body.code : "";
    const totp = user.totpSecret ? verifyTotp(user.totpSecret, code) : { ok: false };
    const backup = totp.ok ? { ok: false } : verifyBackupCode(user.backupCodes, code);
    if (!totp.ok && !backup.ok) {
      return json({ error: TOTP_REFUSED_MESSAGE, totpRequired: true }, { status: 401 });
    }

    const set = mintBackupCodes();
    await updateUser(user.id, { backupCodes: JSON.stringify(set.hashes) });
    return json({ ok: true, backupCodes: set.codes });
  } catch (error) {
    log.error("AUTH", "totp backup-code regeneration failure:", error?.message || error);
    return json({ error: "Two-factor operation failed. Check the server logs." }, { status: 500 });
  }
}
