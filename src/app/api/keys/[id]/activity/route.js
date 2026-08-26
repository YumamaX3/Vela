import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { getApiKeyById } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/[id]/activity — the last N requests for one key, newest
 * first. Feeds the drawer's "Recent activity" micro-surface.
 *
 * Reads usageHistory (migration 004 writes keyId on every usage row; the
 * idx_uh_ts index makes the ORDER BY cheap). Rows are masked to the same
 * fields the usage observatory renders — never full keys, never tokens
 * bodies. Fail-open: any read error yields an empty list, never an
 * exception (the covenant of truth — the drawer renders "no activity").
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const limit = Math.min(50, Math.max(1, parseInt(new URL(request.url).searchParams.get("limit") || "20", 10) || 20));

    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, promptTokens, completionTokens, cost, status, latencyMs, httpStatus
         FROM usageHistory
        WHERE keyId = ?
        ORDER BY timestamp DESC
        LIMIT ?`,
      [id, limit]
    );

    const activity = rows.map((r) => ({
      timestamp: r.timestamp || null,
      provider: r.provider || null,
      model: r.model || null,
      promptTokens: r.promptTokens || 0,
      completionTokens: r.completionTokens || 0,
      cost: r.cost || 0,
      status: r.status || null,
      latencyMs: r.latencyMs ?? null,
      httpStatus: r.httpStatus ?? null,
    }));

    return NextResponse.json({ keyId: id, activity });
  } catch (error) {
    console.error("[API] Failed to load key activity:", error);
    return NextResponse.json({ keyId: id, activity: [] });
  }
}
