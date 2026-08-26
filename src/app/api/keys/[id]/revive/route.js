import { NextResponse } from "next/server";
import { getApiKeyById, createApiKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/[id]/revive — mint a fresh working key under a tombstoned
 * legacy row's name (the Star's "make legacy into latest" choice, applied
 * per-key from the UI). Only tombstoned rows qualify: keyVersion 'legacy',
 * keyHash NULL (governance purged the secret — it can NEVER be recovered,
 * so revive mints a NEW secret, never a re-issue). The old tombstone is
 * deleted after the fresh key lands; the 201 carries the one-time full key
 * (show-once contract), identical to create/duplicate.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const source = await getApiKeyById(id);
    if (!source) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // Only a tombstone qualifies — a live key must never be revived (it
    // would silently mint a second key under the same name).
    const isTombstone =
      source.revoked === true ||
      (source.keyVersion === "legacy" && source.keyHash == null);
    if (!isTombstone) {
      return NextResponse.json(
        { error: "Only a revoked (legacy) key can be revived" },
        { status: 400 }
      );
    }

    const created = await createApiKey(source.name || "Revived Key", {
      category: source.category || null,
    });

    // The tombstone's purpose is fulfilled — drop it so its name isn't split
    // across two rows. (The fresh key now carries the name.)
    const { deleteApiKey } = await import("@/lib/localDb.js");
    await deleteApiKey(id);

    return NextResponse.json(
      {
        key: created.key,
        keyId: created.keyId,
        keyPrefix: created.keyPrefix,
        record: created.record,
        revivedFrom: id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[API] Failed to revive key:", error);
    return NextResponse.json({ error: "Failed to revive key" }, { status: 500 });
  }
}
