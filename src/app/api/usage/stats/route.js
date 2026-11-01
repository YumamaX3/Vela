import { NextResponse } from "next/server";
import { usageStatsShared } from "@/lib/db/index.js";
import { isValidUsagePeriod } from "@/lib/usagePeriods.js";
import * as log from "@/sse/utils/logger.js";

// P5 — this route no longer scans per request on its own: it reads the SHARED
// ≤15s period memo (src/lib/db/index.js usageStatsShared), so a tab refresh, a
// period toggle and the SSE stream's own full paint all ride one window.
// Answer law: the shared read is keyed by the EXACT period string and passes
// it through to getUsageStats unchanged; an unknown period is still a 400 here
// (never a silent default) and a missing one still defaults to "7d".
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!isValidUsagePeriod(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = await usageStatsShared(period);
    return NextResponse.json(stats);
  } catch (error) {
    log.error("USAGE", "Failed to get usage stats:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
