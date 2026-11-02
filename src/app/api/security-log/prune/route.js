// POST /api/security-log/prune — the manual trigger for the 30-day retention.
//
// Retention already enforces itself ON WRITE (every append prunes first), so
// this route is the operator's "sweep now" button — useful after an import or
// a long idle. It deletes exactly what the write path would: rows older than
// SECURITY_LOG_RETENTION_MS. Nothing else is ever removed.
import { NextResponse } from "next/server";
import { pruneSecurityEvents, countSecurityEvents, SECURITY_LOG_RETENTION_MS } from "@/lib/db/repos/securityLogRepo.js";
import * as log from "@/sse/utils/logger.js";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const removed = await pruneSecurityEvents(SECURITY_LOG_RETENTION_MS);
    return NextResponse.json({ status: "ok", removed, remaining: await countSecurityEvents() });
  } catch (error) {
    log.error("API", "Failed to prune security log:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to prune security log" }, { status: 500 });
  }
}
