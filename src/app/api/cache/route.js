// GET /api/cache — semantic cache stats; DELETE — clear or invalidate.
//
// Port of 9router-go `HandleGetCache` (semantic half) + `HandleDeleteCache`.
// The prompt-cache metrics/trend live on the usage surface and are not faked
// here: a field this harbor cannot derive is omitted, never returned as zero
// pretending to be a measurement.
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { semanticCache } from "@/lib/semanticCache.js";
import { semanticCacheDbCount, ensureSemanticCacheHydrated } from "@/lib/semanticCacheDb.js";

export async function GET() {
  try {
    await ensureSemanticCacheHydrated();
    return NextResponse.json({
      semanticCache: semanticCache.stats(await semanticCacheDbCount()),
      config: {
        semanticCacheEnabled: semanticCache.enabled,
        ttlMs: semanticCache.config.ttlMs,
        maxEntries: semanticCache.config.maxEntries,
      },
    });
  } catch (error) {
    log.error("CACHE", "Failed to read stats:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to read cache stats" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");
    const signature = searchParams.get("signature") || searchParams.get("id");
    const staleMs = searchParams.get("staleMs");

    if (model) {
      return NextResponse.json({ success: true, count: semanticCache.invalidateByModel(model) });
    }
    if (signature) {
      return NextResponse.json({ success: semanticCache.deleteEntry(signature) });
    }
    if (staleMs !== null) {
      const ms = Number(staleMs);
      if (!Number.isFinite(ms) || ms <= 0) {
        return NextResponse.json(
          { error: "staleMs must be a positive integer (milliseconds)" },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: true, count: semanticCache.invalidateOlderThan(ms) });
    }

    semanticCache.clear();
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("CACHE", "Failed to invalidate:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to invalidate cache" }, { status: 500 });
  }
}
