import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb";
import { mintKey } from "@/lib/keys/mintService.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/[id]/duplicate — clone a key's limits/ACL/category into a
 * brand-new key ("Copy of {name}"). The new key is minted fresh through the
 * single-writer chokepoint (mintKey) — never a re-issue of the old plaintext;
 * its one-time full key rides the 201 show-once contract. isActive is NOT
 * cloned — a clone starts active.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const source = await getApiKeyById(id);
    if (!source) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const minted = await mintKey({
      name: source.name ? `Copy of ${source.name}` : "Copy of API Key",
      surface: "duplicate",
      actorClass: "dashboard",
      sourceRowId: source.id,
      opts: {
        description: source.description || null,
        category: source.category || null,
        rateLimitRpm: source.rateLimitRpm ?? null,
        tokenBudgetDaily: source.tokenBudgetDaily ?? null,
        spendCapDailyCents: source.spendCapDailyCents ?? null,
        budgetScope: source.budgetScope || null,
        expiresAt: source.expiresAt || null,
        ipAllowlist: Array.isArray(source.ipAllowlist) ? source.ipAllowlist : null,
        allowedModels: Array.isArray(source.allowedModels) ? source.allowedModels : null,
        allowedKinds: Array.isArray(source.allowedKinds) ? source.allowedKinds : null,
        allowedProviders: Array.isArray(source.allowedProviders) ? source.allowedProviders : null,
        allowedCombos: Array.isArray(source.allowedCombos) ? source.allowedCombos : null,
      },
    });

    if (minted.status !== 201) {
      const status = minted.status === 500 ? 500 : 400;
      return NextResponse.json({ error: minted.detail || minted.error || "Failed to duplicate key" }, { status });
    }

    const { key, keyId, keyPrefix, record, meta } = minted.envelope;
    return NextResponse.json(
      { key, keyId, keyPrefix, record, clonedFrom: source.id, meta },
      { status: 201 }
    );
  } catch (error) {
    console.error("[API] Failed to duplicate key:", error);
    return NextResponse.json({ error: "Failed to duplicate key" }, { status: 500 });
  }
}
