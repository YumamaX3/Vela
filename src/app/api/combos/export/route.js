import { NextResponse } from "next/server";
import { getCombos, getSettings } from "@/lib/localDb";
import { isLlmCombo } from "../_lib/combosApi.js";

export const dynamic = "force-dynamic";

// GET /api/combos/export?scope=all|llm
// The whole fleet as one downloadable file — server-side, so the export is the
// database's truth rather than whatever the page happened to have loaded. The
// payload also carries settings.comboStrategies for the exported names, which
// the client-side export never included: a fleet shipped without its strategies
// is a fleet that routes differently on the far shore.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") === "all" ? "all" : "llm";

    const [combos, settings] = await Promise.all([getCombos(), getSettings()]);
    const chosen = (combos || []).filter((c) => (scope === "all" ? true : isLlmCombo(c)));
    const comboStrategies = settings?.comboStrategies || {};

    const strategies = {};
    for (const combo of chosen) {
      if (comboStrategies[combo.name]) strategies[combo.name] = comboStrategies[combo.name];
    }

    const payload = {
      format: "vela-combos",
      version: 1,
      scope,
      exportedAt: new Date().toISOString(),
      combos: chosen.map(({ name, models, kind, createdAt, updatedAt }) => ({
        name,
        models: Array.isArray(models) ? models : [],
        kind: kind || null,
        createdAt: createdAt || null,
        updatedAt: updatedAt || null,
      })),
      strategies,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="vela-combos-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.log("Error exporting combos:", error);
    return NextResponse.json({ error: "Failed to export combos" }, { status: 500 });
  }
}
