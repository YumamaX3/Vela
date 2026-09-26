import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";
import { deleteAllUsers } from "@/lib/db/repos/usersRepo.js";

// Clear the stored dashboard credential. Tag 3 (M0 security foundation):
// there is no "default" to reset TO anymore — clearing drops the install back
// to the unconfigured posture (loopback frictionless, remote refused).
//
// Migration 017: the authority is the authUsers ROW, and `settings.password` is
// only a compatibility mirror of it. Clearing the mirror alone would leave the
// row's bcrypt hash live — the door would keep opening. Both are cleared here:
// the row first (the authority), then the mirror.
// Local-only (enforced by dashboardGuard).
export async function POST() {
  try {
    const removed = await deleteAllUsers();
    await updateSettings({ password: null });
    return NextResponse.json({ success: true, usersRemoved: removed });
  } catch (error) {
    // Error-hygiene (Auth Hardening W1): the caller gets a stable line; the
    // internal detail (a DB or crypto failure describing its own shape) goes to
    // the log, where consoleLogBuffer keeps it readable by the operator.
    console.error("[auth/reset-password] unexpected failure:", error?.message || error);
    return NextResponse.json(
      { error: "Could not reset the password. Check the server logs." },
      { status: 500 }
    );
  }
}
