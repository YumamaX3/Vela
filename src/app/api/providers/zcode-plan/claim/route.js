import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { claimPlan, claimAllOffered } from "open-sse/services/zcodePlanClaim.js";
import { refreshZcodeQuotaForConnection } from "open-sse/services/zcodePlanQuota.js";
import * as log from "@/sse/utils/logger.js";

// POST /api/providers/zcode-plan/claim - Claim one offered plan, or all of them
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connectionId, planId, all } = body || {};
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }
  if (!all && !planId) {
    return NextResponse.json({ error: "Missing planId" }, { status: 400 });
  }

  const connection = await getProviderConnectionById(connectionId);
  if (!connection || connection.provider !== "zcode-plan") {
    return NextResponse.json({ error: "zcode-plan connection not found" }, { status: 404 });
  }

  try {
    const result = all
      ? await claimAllOffered(connection)
      : await claimPlan(connection, planId);

    // Fire-and-forget: refresh the drawer's cached quota balance after a claim.
    if (result?.ok) {
      refreshZcodeQuotaForConnection(connection).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (err) {
    log.warn("PROVIDERS", `zcode-plan claim failed: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
