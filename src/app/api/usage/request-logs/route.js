import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import * as log from "@/sse/utils/logger.js";

export async function GET() {
  try {
    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    log.error("USAGE", "[API ERROR] /api/usage/logs failed:", (error?.message ?? error));
    log.error("USAGE", "[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
