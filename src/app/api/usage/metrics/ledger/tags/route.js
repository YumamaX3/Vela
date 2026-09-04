// Usage Observatory W4-C — PUT /api/usage/metrics/ledger/tags
// The ledger's annotation surface: REPLACE the full tag set on one
// usageHistory row. Reads inherit dashboardGuard's JWT-or-requireLogin
// (its deny-by-default "/api/*" branch) — consistent with every ledger
// sibling (a tag writes about an observed request, so it rides the same
// posture as the read surface; nothing here escalates).
//
// Contract:
//   PUT /api/usage/metrics/ledger/tags
//     body { id: <usageHistory id>, tags: ["prod", "retry", ...] }
//     → 200 { id, tags }        (the stored set, oldest first)
//     → 400                     (invalid id/tag shape; the honest error list)
//
// The four sealed obligations, honored end-to-end: ≤64 chars + charset
// allow-list (requestTagDef.js), parameterized SQL (the repo twins), and
// escape-on-render + CSV safety (React escaping + the export's csvCell).
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).
import { NextResponse } from "next/server";
import { setUsageTags } from "@/lib/db/repos/usageTagsRepo.js";
import { validateTagSet, MAX_TAGS_PER_REQUEST } from "@/lib/requestTagDef.js";

export const dynamic = "force-dynamic";

function errorResponse(status, message, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function PUT(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be JSON");
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return errorResponse(400, "A valid numeric usage id is required");
  }

  const { tags, errors } = validateTagSet(body?.tags);
  if (errors.length) {
    return errorResponse(400, "Invalid tags", { errors, maxTags: MAX_TAGS_PER_REQUEST });
  }

  try {
    const stored = await setUsageTags(id, tags);
    return NextResponse.json({ id, tags: stored });
  } catch (error) {
    console.error("[API] usage/metrics/ledger/tags PUT failed:", error);
    return errorResponse(500, "Failed to save tags");
  }
}
