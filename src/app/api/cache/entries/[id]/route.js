// DELETE /api/cache/entries/[id] — remove one cached answer.
// Port of 9router-go `HandleDeleteCacheEntry`.
import { NextResponse } from "next/server";
import { semanticCache } from "@/lib/semanticCache.js";

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "missing entry id" }, { status: 400 });
    return NextResponse.json({ success: semanticCache.deleteEntry(id) });
  } catch (error) {
    console.error("[Cache] Failed to delete entry:", error);
    return NextResponse.json({ error: "Failed to delete cache entry" }, { status: 500 });
  }
}
