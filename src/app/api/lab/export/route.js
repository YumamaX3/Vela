import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// AI Lab export (W6) — schema-versioned transport for injectors, modes, and
// policies. {schemaVersion:1, kind:'vela-lab-export'}. Session-auth'd by the
// dashboard middleware; never includes secrets (prompt text only — injector
// variables may carry operator defaults, which is their nature).
export async function GET() {
  try {
    const s = await getSettings();
    const payload = {
      schemaVersion: 1,
      kind: "vela-lab-export",
      exportedAt: new Date().toISOString(),
      injectors: Array.isArray(s.userInjectors) ? s.userInjectors : [],
      modes: Array.isArray(s.modeBundles) ? s.modeBundles : [],
      policies: Array.isArray(s.contentPolicies) ? s.contentPolicies : [],
    };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: e.message || "export failed" }, { status: 500 });
  }
}
