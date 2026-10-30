import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { listOfferedPlans } from "open-sse/services/zcodePlanClaim.js";
import * as log from "@/sse/utils/logger.js";

// POST /api/providers/zcode-plan/offers - List plans the connection is offered
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
    const offers = await listOfferedPlans(connection);
    return NextResponse.json({ offers });
  } catch (err) {
    log.warn("PROVIDERS", `zcode-plan offers failed: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
