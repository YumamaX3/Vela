import { NextResponse } from "next/server";
import { getApiKeyById, createApiKey, KeyLimitsValidationError } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/[id]/duplicate — clone a key's limits/ACL/category into a
 * brand-new key ("Copy of {name}"). The new key is minted fresh (never a
 * re-issue of the old plaintext); its one-time full key rides the 201 show-once
 * contract. isActive is NOT cloned — a clone starts active.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const source = await getApiKeyById(id);
    if (!source) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const created = await createApiKey(
      source.name ? `Copy of ${source.name}` : "Copy of API Key",
      {
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
      }
    );

    return NextResponse.json(
      {
        key: created.key,
        keyId: created.keyId,
        keyPrefix: created.keyPrefix,
        record: created.record,
        clonedFrom: source.id,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof KeyLimitsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[API] Failed to duplicate key:", error);
    return NextResponse.json({ error: "Failed to duplicate key" }, { status: 500 });
  }
}
