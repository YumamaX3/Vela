import { NextResponse } from "next/server";
import { getKeyLedgerRows } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/ledger — the append-only key-mutation ledger (Governance
 * Center, W1b, Covenant S3). Records every mint/rotate/revoke with its
 * surface, source row, outcome, actor class, and timestamp. Read-only —
 * never edited after insert. ?surface= and ?limit= filter the stream.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const surface = searchParams.get("surface");
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const rows = await getKeyLedgerRows({ surface, limit });
    return NextResponse.json({ ledger: rows });
  } catch (error) {
    console.error("[API] Failed to fetch key ledger:", error);
    return NextResponse.json({ ledger: [] });
  }
}
