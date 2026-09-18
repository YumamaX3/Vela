import { NextResponse } from "next/server";
import {
  clearConsoleLogs,
  getConsoleLogs,
  getConsoleLogStats,
  initConsoleLogCapture
} from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const structured = searchParams.get("structured") === "true";
    const level = searchParams.get("level") || "all";
    const tag = searchParams.get("tag") || "all";
    const query = searchParams.get("q") || "";
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : null;
    const includeStats = searchParams.get("stats") === "true";

    const logs = getConsoleLogs({ level, query, tag, limit, structured });
    const stats = includeStats ? getConsoleLogStats() : undefined;

    return NextResponse.json({
      success: true,
      logs,
      stats,
    });
  } catch (error) {
    console.error("Error getting console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearConsoleLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
