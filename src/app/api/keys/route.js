import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, KeyLimitsValidationError, sanitizeCategory } from "@/lib/localDb";

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
    console.error("Error fetching keys:", error?.message || error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys — 201 carries the ONE-TIME full key (show-once contract).
// Never retrievable again; only its SHA-256 hash is persisted.
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (name.trim().length > 200) {
      return NextResponse.json({ error: "Name must be 200 characters or fewer" }, { status: 400 });
    }

    // Per-key ACL dimensions (v0.9.17) — each is tri-state: omitted/null = all
    // allowed, [] = deny, ["x"] = whitelist. Arrays are deduped + trimmed; any
    // non-string member is rejected.
    const parseScope = (value, field) => {
      if (value == null) return null;
      if (!Array.isArray(value) || value.some((m) => typeof m !== "string" || !m.trim())) {
        throw new Error(`${field} must be an array of strings (or omitted for unrestricted)`);
      }
      return [...new Set(value.map((m) => m.trim()))];
    };
    let scope = null;
    let allowedKinds = null;
    let allowedProviders = null;
    let allowedCombos = null;
    try {
      scope = parseScope(body.allowedModels, "allowedModels");
      allowedKinds = parseScope(body.allowedKinds, "allowedKinds");
      allowedProviders = parseScope(body.allowedProviders, "allowedProviders");
      allowedCombos = parseScope(body.allowedCombos, "allowedCombos");
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    // Category — free-form label, validated at the gate (trim/collapse/length cap).
    let category = null;
    try {
      category = sanitizeCategory(body.category);
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const created = await createApiKey(name.trim(), {
      description: typeof description === "string" ? description.trim() || null : null,
      allowedModels: scope,
      allowedKinds,
      allowedProviders,
      allowedCombos,
      category,
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
    console.error("Error creating key:", error?.message || error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
