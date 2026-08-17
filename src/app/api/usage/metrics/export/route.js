// Usage Observatory W2-B — GET /api/usage/metrics/export
//
// The streaming CSV export. phase13 obligations, all honored here:
//   • ALWAYS_PROTECTED — JWT regardless of requireLogin (dashboardGuard).
//   • Formula injection — EVERY cell is quoted; a cell beginning with
//     = + - @ gets a leading tab inside the quotes so spreadsheet apps treat
//     it as text, never a formula. (CSV =,+,-,@-padding, phase13 §EoP.)
//   • Concurrency — ONE export in flight server-wide; a second caller gets
//     429 EXPORT_IN_PROGRESS. (phase13 §DoS "1 concurrent export".)
//   • DoS rail — the same census + row cap as the screen (EXPORT_ROW_CAP);
//     when the cap bites, the file ends with a truncation note — the export
//     never silently disagrees with what the cap actually returned.
//   • Fixed attachment filename — nothing user-controlled in headers.
import { NextResponse } from "next/server";
import { getExportCursor } from "@/lib/usageDb";
// The DoS rail constant is engine-neutral (frozen at definition) — import it
// from its home rather than growing the shim for a bare number.
import { EXPORT_ROW_CAP } from "@/lib/db/usageAggregation";
import { parseFilters, parsePeriod, metricsErrorResponse, metricsThrottle } from "../_lib/params";

export const dynamic = "force-dynamic";

// Server-wide single-flight lock (phase13 DoS rail).
let exportActive = false;

const COLUMNS = [
  ["id", "id"],
  ["timestamp", "timestamp"],
  ["provider", "provider"],
  ["providerDisplayName", "providerDisplayName"],
  ["model", "model"],
  ["accountName", "accountName"],
  ["keyName", "keyName"],
  ["endpoint", "endpoint"],
  ["promptTokens", "promptTokens"],
  ["completionTokens", "completionTokens"],
  ["cachedTokens", "cachedTokens"],
  ["cost", "cost"],
  ["status", "status"],
  ["statusClass", "statusClass"],
  ["latencyMs", "latencyMs"],
  ["ttftMs", "ttftMs"],
  ["httpStatus", "httpStatus"],
  ["rtkBytesSaved", "rtk.bytesSaved"],
  ["rtkTokensSavedEst", "rtk.tokensSavedEst"],
  ["rtkSavedCostUsd", "rtkSavedCostUsd"],
  // W4-C — operator request tags. The ledger row carries them as an array;
  // rowToLine joins them below. The charset allow-list (requestTagDef.js)
  // excludes commas, quotes, and angle brackets by construction, so the
  // ", " join can never forge a new cell — and csvCell still guards the
  // whole cell with quoting + the formula tab-pad.
  ["tags", null],
];

/** One CSV cell: always quoted, internal quotes doubled, and a leading tab
 *  padded inside the quotes when the value starts with = + - @ (formula
 *  injection guard — spreadsheet apps treat tab-prefixed content as text). */
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `\t${s}`; // pad INSIDE the quotes
  return `"${s.replace(/"/g, '""')}"`;
}

function rowToLine(row) {
  return COLUMNS.map(([header]) => {
    const dot = header.indexOf(".");
    if (dot === -1) {
      const v = row[header];
      // W4-C — array cells (tags) join on ", "; the allow-list keeps commas
      // out of any single tag, so the join is unambiguous inside the quotes.
      return csvCell(Array.isArray(v) ? v.join(", ") : v);
    }
    const sub = row[header.slice(0, dot)];
    return csvCell(sub ? sub[header.slice(dot + 1)] : null);
  }).join(",");
}

export async function GET(request) {
  if (!metricsThrottle()) {
    return NextResponse.json({ error: "RATE_LIMITED", retryAfter: 10 }, { status: 429 });
  }
  if (exportActive) {
    return NextResponse.json(
      { error: "EXPORT_IN_PROGRESS", message: "Another export is already running. Wait for it to finish." },
      { status: 429 }
    );
  }

  let parsed;
  try {
    const { searchParams } = new URL(request.url);
    parsed = {
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams, "60d"),
      sort: searchParams.get("sort") || "timestamp",
      order: searchParams.get("order") === "asc" ? "asc" : "desc",
    };
  } catch (error) {
    return metricsErrorResponse(error, "export");
  }

  exportActive = true;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        controller.enqueue(enc.encode(COLUMNS.map(([h]) => csvCell(h)).join(",") + "\n"));
        const cursor = await getExportCursor(parsed); // await-first: both postures
        let count = 0;
        for await (const row of cursor) {
          if (request.signal?.aborted) break;
          controller.enqueue(enc.encode(rowToLine(row) + "\n"));
          count++;
        }
        // The cursor yields AT MOST cap rows; hitting the cap exactly means
        // there may be more — the honesty clause writes the truncation note
        // INTO the CSV (a response header can't know truncation before the
        // stream runs, so the in-file note is the truthful record).
        if (count >= EXPORT_ROW_CAP) {
          controller.enqueue(
            enc.encode(csvCell(`# NOTE: export truncated at ${EXPORT_ROW_CAP} rows — narrow the period or filters for the full ledger.`) + "\n")
          );
        }
        controller.close();
      } catch (error) {
        console.error("[API] usage/metrics/export failed:", error);
        try { controller.close(); } catch { /* already closed */ }
      } finally {
        exportActive = false;
      }
    },
    cancel() {
      exportActive = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Fixed filename — nothing user-controlled reaches a header (phase13).
      "Content-Disposition": "attachment; filename=\"vela-usage-export.csv\"",
    },
  });
}
