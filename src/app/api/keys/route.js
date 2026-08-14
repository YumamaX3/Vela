import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, KeyLimitsValidationError } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/keys — masked rows only; internal rows stripped at the repo.
// Lightweight pagination: ?limit= (default 100, max 500) & ?offset=.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);

    const keys = await getApiKeys();
    const page = keys.slice(offset, offset + limit);
    return NextResponse.json({ keys: page, total: keys.length, limit, offset });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys — 201 carries the ONE-TIME full key (show-once contract).
// Never retrievable again; only its SHA-256 hash is persisted.
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description, allowedModels } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate allowedModels shape: array of non-empty strings, or null (unrestricted)
    let scope = null;
    if (allowedModels != null) {
      if (!Array.isArray(allowedModels) || allowedModels.some((m) => typeof m !== "string" || !m.trim())) {
        return NextResponse.json({ error: "allowedModels must be an array of model ids (or omitted for unrestricted)" }, { status: 400 });
      }
      scope = [...new Set(allowedModels.map((m) => m.trim()))];
    }

    const created = await createApiKey(name.trim(), {
      description: typeof description === "string" ? description.trim() || null : null,
      allowedModels: scope,
      // W3 governance opts — validated by the repo (KeyLimitsValidationError
      // → 400 below). Absent fields stay null = unlimited / unrestricted.
      rateLimitRpm: body.rateLimitRpm,
      tokenBudgetDaily: body.tokenBudgetDaily,
      spendCapDailyCents: body.spendCapDailyCents,
      budgetScope: body.budgetScope,
      expiresAt: body.expiresAt,
      ipAllowlist: body.ipAllowlist,
    });

    return NextResponse.json({
      key: created.key, // one-time full key — shown only here
      keyId: created.keyId,
      keyPrefix: created.keyPrefix,
      record: created.record,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof KeyLimitsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
