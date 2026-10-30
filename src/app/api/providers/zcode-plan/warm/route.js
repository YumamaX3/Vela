import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { sendWarmEvents } from "open-sse/services/zcodePlanClaim.js";
import * as log from "@/sse/utils/logger.js";

// POST /api/providers/zcode-plan/warm - Send warm-up events for the connection
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connectionId } = body || {};
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  const connection = await getProviderConnectionById(connectionId);
  if (!connection || connection.provider !== "zcode-plan") {
    return NextResponse.json({ error: "zcode-plan connection not found" }, { status: 404 });
  }

  try {
    // Both ok:true and ok:false are legitimate outcomes; the panel surfaces `problem`.
    const result = await sendWarmEvents(connection);
    return NextResponse.json(result);
  } catch (err) {
    log.warn("PROVIDERS", `zcode-plan warm failed: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
