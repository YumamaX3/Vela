import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import * as log from "@/sse/utils/logger.js";

export async function GET() {
  try {
    const stats = await getUsageStats();
    return NextResponse.json(stats);
  } catch (error) {
    log.error("USAGE", "Error fetching usage stats:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
