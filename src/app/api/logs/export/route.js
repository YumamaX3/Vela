// Log Pipeline v2 · M7 — GET /api/logs/export
//
// §6's NDJSON export. Four laws, each one closing a specific finding:
//
//   • NDJSON, NEVER CSV. §1 measured the CSV formula-injection defense
//     (`= + - @` tab-padding) and found it belongs to the CSV export it was
//     built for: inside JSON those characters are inert string content. A CSV
//     export here would carry a defense for a threat JSON does not have, and
//     lose the escaping correctness JSON does need.
//   • STREAM, never buffer. `iterateLogRows` is an async generator over
//     keyset windows, so peak memory is one page no matter how large the cap
//     is. Building an array first would be the O(file) pause §6 refuses.
//   • THE SHARED CAP, ENFORCED. `EXPORT_ROW_CAP` is imported from its home
//     (@/lib/db/usageAggregation) rather than re-typed, because a second copy
//     of 200,000 is how a DoS rail starts lying about what it bounds.
//   • HONEST TRUNCATION. When the cap bites, the file ends with a
//     `"_truncated": true` marker LINE — inside the body, because a response
//     header cannot know truncation before the stream runs. A silently short
//     file is a file that lies about its own completeness.
//
// THE FILENAME IS FIXED. Nothing user-controlled reaches a header: a
// Content-Disposition built from a query parameter is a header-injection seam
// and a filename-spoofing one.
import { NextResponse } from "next/server";
import { EXPORT_ROW_CAP } from "@/lib/db/usageAggregation";
import { iterateLogRows } from "@/lib/db/repos/sqlite/logQuery.js";
import { SelectorError, parseLogSelector } from "@/lib/logSelector.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Rows per DB window. Bounded so the export never holds more than this. */
const PAGE_SIZE = 1_000;

export async function GET(request) {
  let selector;
  let narrowed = false;
  let q = null;
  try {
    const parsed = parseLogSelector(new URL(request.url).searchParams);
    selector = parsed.selector;
    narrowed = parsed.narrowed;
    q = parsed.q;
  } catch (error) {
    // The same 400 laws as /events — a bad selector is refused by name here
    // too, rather than exporting a file that silently ignored it.
    if (error instanceof SelectorError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    throw error;
  }

  const qHonoured = q !== null && narrowed;
  // An export is a whole-range read: the paging `limit`/`before` are the QUERY
  // door's cursor, not the export's. Honouring them here would ship a file
  // that looks complete and is a fragment.
  const range = { ...selector, limit: PAGE_SIZE, before: null };

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let count = 0;
      try {
        for await (const row of iterateLogRows({ pageSize: PAGE_SIZE, cap: EXPORT_ROW_CAP, selector: range, q, opts: { qHonoured } })) {
          if (request.signal?.aborted) break;
          controller.enqueue(enc.encode(JSON.stringify(row) + "\n"));
          count += 1;
        }
        // The honesty line. Hitting the cap EXACTLY means there may be more —
        // the same reasoning the usage export uses, stated as JSON rather than
        // as a CSV comment so the file stays machine-readable line by line.
        if (count >= EXPORT_ROW_CAP) {
          controller.enqueue(
            enc.encode(
              JSON.stringify({
                _truncated: true,
                cap: EXPORT_ROW_CAP,
                note: "Export truncated at the row cap — narrow the selector for the full ledger.",
              }) + "\n"
            )
          );
        }
        controller.close();
      } catch (error) {
        console.error("[API] logs/export failed:", error);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Fixed filename — nothing user-controlled reaches a header.
      "Content-Disposition": 'attachment; filename="vela-logs-export.ndjson"',
      // The cap is declared BEFORE the stream runs, so a client can see the
      // bound it is about to receive without reading the body.
      "X-Vela-Export-Cap": String(EXPORT_ROW_CAP),
    },
  });
}
