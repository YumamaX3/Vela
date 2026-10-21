// GET /api/debug/traces?limit=|?n= — recent spans + per provider/model latency.
// `n` is the Go handler's parameter name; both spellings are accepted so an
// older client or a bookmark keeps working.
// Port of 9router-go's debug tracing payload.
import { NextResponse } from "next/server";
import { tracesPayload } from "@/lib/tracing.js";

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.max(0, Number(params.get("n") ?? params.get("limit")) || 0);
    return NextResponse.json(tracesPayload(limit));
  } catch (error) {
    console.error("[Traces] Failed to read spans:", error);
    return NextResponse.json({ error: "Failed to read traces" }, { status: 500 });
  }
}
