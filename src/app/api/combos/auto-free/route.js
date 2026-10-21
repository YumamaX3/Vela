// POST /api/combos/auto-free — (re)build the free-tier rollup.
//
// Port of 9router-go `HandleAutoFreeCombo`. The combo keeps a stable id, so a
// rebuild replaces the row instead of stacking a new one. A rebuild is
// explicit because it overwrites whatever the operator edited.
import { NextResponse } from "next/server";
import { upsertComboWithId } from "@/lib/db/repos/combosRepo.js";
import { AUTO_FREE_COMBO_ID, FREE_COMBO_KIND, freeTierComboModels } from "@/lib/combos/autoGenerate.js";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const models = await freeTierComboModels();
    if (!models.length) {
      return NextResponse.json(
        { error: "no free-tier models found among providers with active connections" },
        { status: 409 }
      );
    }
    const combo = await upsertComboWithId(AUTO_FREE_COMBO_ID, {
      name: "Auto Free Tier",
      kind: FREE_COMBO_KIND,
      models,
    });
    return NextResponse.json({ status: "ok", id: combo.id, models, combo });
  } catch (error) {
    console.error("[Combos] auto-free failed:", error);
    return NextResponse.json({ error: "Failed to build the free-tier combo" }, { status: 500 });
  }
}
