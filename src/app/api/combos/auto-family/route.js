// POST /api/combos/auto-family — one fallback combo per model family.
//
// Port of 9router-go `HandleAutoFamilyCombos`. Families with fewer than two
// usable members are skipped: a single model has nothing to fall back to.
// Generated combos stay editable — they are a starting point, not registry
// truth.
import { NextResponse } from "next/server";
import { upsertComboWithId } from "@/lib/db/repos/combosRepo.js";
import {
  FAMILY_COMBO_KIND,
  autoFamilyComboId,
  usableModelFamilies,
} from "@/lib/combos/autoGenerate.js";

export const dynamic = "force-dynamic";

const MIN_FAMILY_MEMBERS = 2;

export async function POST() {
  try {
    const groups = await usableModelFamilies();
    const created = [];
    for (const [family, members] of groups) {
      if (members.length < MIN_FAMILY_MEMBERS) continue;
      await upsertComboWithId(autoFamilyComboId(family), {
        name: `Auto: ${family}`,
        kind: FAMILY_COMBO_KIND,
        models: members,
      });
      created.push(family);
    }
    created.sort();
    return NextResponse.json({ status: "ok", created, count: created.length });
  } catch (error) {
    console.error("[Combos] auto-family failed:", error);
    return NextResponse.json({ error: "Failed to build family combos" }, { status: 500 });
  }
}
