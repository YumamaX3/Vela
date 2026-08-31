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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
