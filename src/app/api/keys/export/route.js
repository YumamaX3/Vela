import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { EXPORT_ENVELOPE, EXPORT_VERSION, redactKeyForExport } from "../_lib/keysApi.js";

export const dynamic = "force-dynamic";

// GET /api/keys/export — the fleet's SHAPE as a downloadable file.
//
// What is inside: every governance field that can be rebuilt (name, scope, the
// ACL triple, ceilings, expiry, category). What is NOT, and cannot be: the key
// strings themselves. Keys are hash-at-rest and show-once — the plaintext stops
// existing server-side the moment the 201 leaves — so there is nothing to
// export even in principle, and this file is not a credential backup. An import
// of it mints NEW credentials.
//
// The row is enumerated field by field through redactKeyForExport rather than
// spread from the record, so a column added later cannot ride out by accident.
export async function GET() {
  try {
    const keys = await getApiKeys();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new NextResponse(
      JSON.stringify(
        {
          app: EXPORT_ENVELOPE,
          version: EXPORT_VERSION,
          exportedAt: new Date().toISOString(),
          count: keys.length,
          keys: keys.map(redactKeyForExport),
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="vela-keys-${stamp}.json"`,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.log("Error exporting keys:", error);
    return NextResponse.json({ error: "Failed to export keys" }, { status: 500 });
  }
}
