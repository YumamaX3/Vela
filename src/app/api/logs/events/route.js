// Log Pipeline v2 · M7 — GET /api/logs/events
//
// §6's structured selector: minLvl (>=) · stream · provider · tag · reqId
// (exact) · upstreamId (exact) · since/until (ms) · q (LIKE on msg, applied
// AFTER the selector narrows) · limit + `before` cursor (keyset on id, never
// OFFSET).
//
// THE DOOR'S POSTURE: `"/api/logs"` is already in dashboardGuard's
// ALWAYS_PROTECTED roster, so this whole prefix requires a JWT regardless of
// requireLogin — on the common requireLogin===false posture a REMOTE
// credential-less caller reads nothing here. The roster comment carries the
// reason: these rows are redacted-but-sensitive, /export is the richest
// reconnaissance surface in the product, and /clear is irreversible. Nothing
// is re-declared here; adding a second auth branch would only create a path
// the roster does not cover.
import { NextResponse } from "next/server";
import { queryLogPage } from "@/lib/db/repos/sqlite/logQuery.js";
import { SelectorError, parseLogSelector } from "@/lib/logSelector.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { selector, narrowed, q } = parseLogSelector(searchParams);

    // THE TWO-TIER LAW, enforced here where it is readable: free text rides a
    // selector that has already narrowed. `q` is still ECHOED back when it is
    // ignored (the client rendered it), and `qHonoured` says which happened —
    // a filter that silently stops applying is the same silent-lie class as the
    // NaN selector the 400 laws exist to kill.
    const qHonoured = q !== null && narrowed;
    const page = await queryLogPage(selector, q, { qHonoured });

    return NextResponse.json({
      rows: page.rows,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      // The two-tier verdict, stated rather than inferred.
      q: q ?? null,
      qHonoured,
      qIgnoredBecauseUnnarrowed: q !== null && !qHonoured,
    });
  } catch (error) {
    // A SelectorError is a NAMED refusal: the field, the reason, 400. Never a
    // 200 with zero rows — the 3 a.m. silent-empty class.
    if (error instanceof SelectorError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    console.error("[API] logs/events failed:", error);
    return NextResponse.json({ error: "Failed to read log events" }, { status: 500 });
  }
}
