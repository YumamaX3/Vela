import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";

// Clear the stored dashboard password hash. Tag 3 (M0 security foundation):
// there is no "default" to reset TO anymore — clearing drops the install back
// to the unconfigured posture (loopback frictionless, remote refused).
// Local-only (enforced by dashboardGuard).
export async function POST() {
  try {
    await updateSettings({ password: null });
    return NextResponse.json({ success: true });
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
