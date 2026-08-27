import { NextResponse } from "next/server";
import { getRecentUsageIds, getTagsForUsageIds } from "@/lib/usageDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// AI Lab Observe tab — the wire viewer. Returns the 50 most recent usage
// rows with their request tags (mode:/policy:/servingLane:/injector names),
// oldest-order per request. Honors the S7 observability flag — when it is
// OFF, returns an honest disabled envelope instead of pretending records
// exist (the AI Lab row-tag writer is likewise gated, so there is nothing
// to show). The Observe tab reads this truth-honestly.
export async function GET() {
  try {
    const { getSettings } = await import("@/lib/localDb");
    const s = await getSettings();
    const enabled = s.enableObservability === true;
    if (!enabled) {
      return NextResponse.json({ tags: [], disabled: true });
    }
    const ids = await getRecentUsageIds(50);
    const tagMap = await getTagsForUsageIds(ids);
    const tags = ids.map((id) => ({
      usageId: id,
      names: tagMap.get(id) || [],
    }));
    return NextResponse.json({ tags, disabled: false });
  } catch (e) {
    console.error("[API ERROR] /api/usage/tags failed:", e?.message);
    return NextResponse.json({ error: "Failed to fetch usage tags" }, { status: 500 });
  }
}
