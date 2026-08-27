import { NextResponse } from "next/server";
import { getApiKeys, sanitizeCategory } from "@/lib/localDb";
import { mintKey } from "@/lib/keys/mintService.js";

export const dynamic = "force-dynamic";

// Fields the export carries — name/limits/ACL/category. Full keys are NEVER
// exportable: the show-once contract keeps the plaintext out of every list
// surface, and the export is the settings mirror for re-import, not a backup
// of credentials.
function toSettingsRow(k) {
  return {
    name: k.name || null,
    description: k.description || null,
    category: k.category || null,
    rateLimitRpm: k.rateLimitRpm ?? null,
    tokenBudgetDaily: k.tokenBudgetDaily ?? null,
    spendCapDailyCents: k.spendCapDailyCents ?? null,
    budgetScope: k.budgetScope || null,
    expiresAt: k.expiresAt || null,
    ipAllowlist: Array.isArray(k.ipAllowlist) ? k.ipAllowlist : null,
    allowedModels: Array.isArray(k.allowedModels) ? k.allowedModels : null,
    allowedKinds: Array.isArray(k.allowedKinds) ? k.allowedKinds : null,
    allowedProviders: Array.isArray(k.allowedProviders) ? k.allowedProviders : null,
    allowedCombos: Array.isArray(k.allowedCombos) ? k.allowedCombos : null,
  };
}

function sanitizeArray(v) {
  return v != null && Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : null;
}

/**
 * GET /api/keys/export — settings-only export (NEVER full keys / secret
 * material). The dashboard downloads this as vela-key-settings.json and can
 * re-import it to rebuild governance on a fresh instance.
 */
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({
      app: "vela",
      version: 1,
      exportedAt: new Date().toISOString(),
      keys: keys.map(toSettingsRow),
    });
  } catch (error) {
    console.error("[API] Failed to export key settings:", error);
    return NextResponse.json({ error: "Failed to export key settings" }, { status: 500 });
  }
}

/**
 * POST /api/keys/export — re-import settings rows (name/limits/ACL/category).
 * Mirrors the create path exactly (sanitized, validated, fail-closed on bad
 * shapes) without ever minting or returning a full key unless a row is
 * actually created — and then the 201 show-once contract applies as usual.
 * Response: { created: N, errors: [...] } — never secret material.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const rows = Array.isArray(body?.keys) ? body.keys : null;
    if (!rows) {
      return NextResponse.json({ error: "Expected { keys: [...] }" }, { status: 400 });
    }

    let created = 0;
    const errors = [];
    for (const row of rows) {
      try {
        if (!row || typeof row !== "object") throw new Error("row must be an object");
        const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
        if (!name) throw new Error("name is required");

        const category = sanitizeCategory(row.category);
        // Import-mint — the fifth mint surface converges on mintKey so every
        // minted credential rides the write-before-commit reveal-sink + ledger.
        // The reveal is consumed on the next dashboard load (GET
        // /api/keys/pending-reveals), preserving show-once even for batch import.
        const minted = await mintKey({
          name,
          surface: "import-mint",
          actorClass: "dashboard",
          opts: {
            description: typeof row.description === "string" ? row.description.trim() || null : null,
            category,
            rateLimitRpm: row.rateLimitRpm ?? null,
            tokenBudgetDaily: row.tokenBudgetDaily ?? null,
            spendCapDailyCents: row.spendCapDailyCents ?? null,
            budgetScope: row.budgetScope ?? null,
            expiresAt: row.expiresAt ?? null,
            ipAllowlist: sanitizeArray(row.ipAllowlist),
            allowedModels: sanitizeArray(row.allowedModels),
            allowedKinds: sanitizeArray(row.allowedKinds),
            allowedProviders: sanitizeArray(row.allowedProviders),
            allowedCombos: sanitizeArray(row.allowedCombos),
          },
        });
        if (minted.status !== 201) throw new Error(minted.detail || minted.error || "mint failed");
        created += 1;
      } catch (e) {
        errors.push({ name: row?.name || "?", error: e.message });
      }
    }

    return NextResponse.json({ created, errors });
  } catch (error) {
    console.error("[API] Failed to import key settings:", error);
    return NextResponse.json({ error: "Failed to import key settings" }, { status: 500 });
  }
}
