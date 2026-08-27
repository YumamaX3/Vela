import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { planImport, validateImportPayload } from "open-sse/rtk/importPlanner.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// AI Lab import (W6) — schema-versioned, collision-safe, DISABLED-on-arrival.
// The pure importPlanner holds the tested contract (the lab-import-export
// suite); this route only loads state, plans, and persists. Unknown
// schemaVersion → 400 (the planner throws, caught here).
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    validateImportPayload(body); // 400 on unsupported schema
    const current = await getSettings();
    const plan = planImport(body, current);
    await updateSettings({
      userInjectors: plan.injectors,
      modeBundles: plan.modes,
      contentPolicies: plan.policies,
    });
    return NextResponse.json({ ok: true, report: plan.report });
  } catch (e) {
    return NextResponse.json({ error: e.message || "import failed" }, { status: 400 });
  }
}
