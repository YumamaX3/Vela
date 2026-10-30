import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

// GET /api/providers/zcode-plan/auto-claim - Read the auto-claim preference
export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ enabled: settings.zcodePlanAutoClaim === "1" });
}

// POST /api/providers/zcode-plan/auto-claim - Set the auto-claim preference
export async function POST(request) {
  const body = await request.json();
  const enabled = !!body?.enabled;
  await updateSettings({ zcodePlanAutoClaim: enabled ? "1" : "0" });
  return NextResponse.json({ enabled });
}
