import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import * as log from "@/sse/utils/logger.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "14d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = await getUsageStats(period);
    return NextResponse.json(stats);
  } catch (error) {
    log.error("USAGE", "Failed to get usage stats:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
