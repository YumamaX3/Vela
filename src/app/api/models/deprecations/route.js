// GET /api/models/deprecations?provider= — recorded model retirements.
//
// Port of 9router-go `HandleGetModelDeprecations`. Rows are keyed by
// "<provider>/<model>" — the same key a combo entry is written as — so the
// dashboard can badge a whole model list in one pass. An unknown model is
// simply absent; it is never reported as "alive".
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { listModelDeprecations } from "@/lib/db/repos/deprecationsRepo.js";

export async function GET(request) {
  try {
    const provider = (new URL(request.url).searchParams.get("provider") || "").trim();
    const deprecations = await listModelDeprecations(provider);
    return NextResponse.json({ provider, deprecations });
  } catch (error) {
    log.error("MODELS", "Failed to read deprecations:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to read model deprecations" }, { status: 500 });
  }
}
