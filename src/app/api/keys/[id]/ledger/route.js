import { NextResponse } from "next/server";
import { getApiKeyById, getKeyLedgerRows } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/[id]/ledger — one key's mutation history (Governance Center,
 * W1b). Scoped by keyId so the drawer can show this key's provenance without
 * mixing the fleet stream. Read-only, newest first.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const rows = await getKeyLedgerRows({ keyId: id, limit });
    return NextResponse.json({ keyId: id, ledger: rows });
  } catch (error) {
    console.error("[API] Failed to fetch key ledger:", error);
    return NextResponse.json({ keyId: null, ledger: [] });
  }
}
