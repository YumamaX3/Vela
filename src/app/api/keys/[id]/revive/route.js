import { NextResponse } from "next/server";
import { getApiKeyById, deleteWithScrub } from "@/lib/localDb";
import { mintKey } from "@/lib/keys/mintService.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/[id]/revive — mint a fresh working key under a tombstoned
 * legacy row's name (the Star's "make legacy into latest" choice, applied
 * per-key from the UI). Only tombstoned rows qualify: keyVersion 'legacy',
 * keyHash NULL (governance purged the secret — it can NEVER be recovered,
 * so revive mints a NEW secret, never a re-issue). The old tombstone is
 * scrubbed after the fresh key lands; the 201 carries the one-time full key
 * (show-once contract), identical to create/duplicate.
 *
 * The mint rides the single-writer chokepoint (mintKey) — write-before-commit
 * reveal-sink + append-only ledger. The tombstone scrub rides deleteWithScrub
 * (app-level tag purge in one transaction, Covenant M5).
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

    const minted = await mintKey({
      name: source.name || "Revived Key",
      surface: "revive",
      actorClass: "dashboard",
      sourceRowId: source.id,
      opts: {
        category: source.category || null,
      },
    });

    if (minted.status !== 201) {
      const status = minted.status === 500 ? 500 : 400;
      return NextResponse.json({ error: minted.detail || minted.error || "Failed to revive key" }, { status });
    }

    // The tombstone's purpose is fulfilled — scrub it so its name isn't split
    // across two rows. (The fresh key now carries the name.)
    await deleteWithScrub(id);

    const { key, keyId, keyPrefix, record, meta } = minted.envelope;
    return NextResponse.json(
      { key, keyId, keyPrefix, record, revivedFrom: id, meta },
      { status: 201 }
    );
  } catch (error) {
    console.error("[API] Failed to revive key:", error);
    return NextResponse.json({ error: "Failed to revive key" }, { status: 500 });
  }
}
