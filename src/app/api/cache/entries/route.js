// GET /api/cache/entries — paginated, filtered, sorted cache metadata.
// Port of 9router-go `HandleGetCacheEntries`.
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { semanticCache } from "@/lib/semanticCache.js";
import { ensureSemanticCacheHydrated } from "@/lib/semanticCacheDb.js";

export async function GET(request) {
  try {
    await ensureSemanticCacheHydrated();
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page")) || 1;
    const limit = Number(searchParams.get("limit")) || 20;
    const search = searchParams.get("search") || "";
    const model = searchParams.get("model") || "";
    const sortBy = searchParams.get("sortBy") || "created_at";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    const result = semanticCache.listEntries({ page, limit, search, model, sortBy, sortOrder });
    return NextResponse.json({
      entries: result.entries,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
      },
    });
  } catch (error) {
    log.error("CACHE", "Failed to list entries:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to list cache entries" }, { status: 500 });
  }
}
