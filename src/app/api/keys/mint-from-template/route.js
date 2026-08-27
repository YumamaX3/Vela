import { NextResponse } from "next/server";
import { getTemplate, applyShape } from "@/lib/localDb";
import { mintKey } from "@/lib/keys/mintService.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/mint-from-template — the SIXTH mint surface (template-apply,
 * Shorekeeper-Sealed Plan §2.2). Loads a saved preset, normalizes it through
 * applyShape (the single normalization path — template `limits.tokenBudget` →
 * `tokenBudgetDaily`, `limits.spendCapCents` → `spendCapDailyCents`), then
 * mints through mintKey with surface "template-apply" so the mutation ledger
 * records the true provenance.
 *
 * Body: { templateId, name?, category? }. A missing/invalid templateId 404s —
 * the wizard fails open to the Blank preset client-side, so this is a hard
 * contract only when a template is explicitly chosen.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const templateId = body?.templateId;
    if (typeof templateId !== "string" || !templateId) {
      return NextResponse.json({ error: "templateId is required" }, { status: 400 });
    }

    const template = await getTemplate(templateId);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Normalize through applyShape — overrides win, defaults from the preset.
    const shape = applyShape(template, {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      category: body.category !== undefined ? body.category : undefined,
    });

    const minted = await mintKey({
      name: shape.name || template.name || "Minted Key",
      surface: "template-apply",
      actorClass: "dashboard",
      sourceRowId: template.id,
      opts: {
        description: shape.description || null,
        category: shape.category,
        allowedModels: shape.allowedModels,
        allowedKinds: shape.allowedKinds,
        allowedProviders: shape.allowedProviders,
        allowedCombos: shape.allowedCombos,
        rateLimitRpm: shape.rateLimitRpm,
        tokenBudgetDaily: shape.tokenBudgetDaily,
        spendCapDailyCents: shape.spendCapDailyCents,
        budgetScope: shape.budgetScope,
        expiresAt: shape.expiresAt,
        ipAllowlist: shape.ipAllowlist,
      },
    });

    if (minted.status !== 201) {
      const status = minted.status === 500 ? 500 : 400;
      return NextResponse.json({ error: minted.detail || minted.error || "Failed to mint key" }, { status });
    }

    const { key, keyId, keyPrefix, record, meta } = minted.envelope;
    return NextResponse.json({ key, keyId, keyPrefix, record, templateId: template.id, meta }, { status: 201 });
  } catch (error) {
    console.error("[API] Failed to mint from template:", error);
    return NextResponse.json({ error: "Failed to mint key" }, { status: 500 });
  }
}
