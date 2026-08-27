import { NextResponse } from "next/server";
import { getApiKeys, sanitizeCategory } from "@/lib/localDb";
import { mintKey } from "@/lib/keys/mintService.js";

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
    let allowedModes = null;
    let allowedInjectors = null;
    let labDefaultMode = null;
    try {
      scope = parseScope(body.allowedModels, "allowedModels");
      allowedKinds = parseScope(body.allowedKinds, "allowedKinds");
      allowedProviders = parseScope(body.allowedProviders, "allowedProviders");
      allowedCombos = parseScope(body.allowedCombos, "allowedCombos");
      allowedModes = parseScope(body.allowedModes, "allowedModes");
      allowedInjectors = parseScope(body.allowedInjectors, "allowedInjectors");
      if (body.defaultMode != null && typeof body.defaultMode !== "string") {
        throw new Error("defaultMode must be a string (a mode name) or omitted");
      }
      labDefaultMode = body.defaultMode ? body.defaultMode.trim() || null : null;
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

    // Converge on mintKey() — the single-writer chokepoint over every mint
    // surface (write-before-commit, reveal-sink, append-only ledger). The
    // 201 wire shape stays identical for the dashboard; the envelope adds
    // meta (surface, revealId, actorClass) without breaking existing clients.
    const minted = await mintKey({
      name: name.trim(),
      surface: "create",
      actorClass: "dashboard",
      opts: {
        description: typeof description === "string" ? description.trim() || null : null,
        allowedModels: scope,
        allowedKinds,
        allowedProviders,
        allowedCombos,
        allowedModes,
        allowedInjectors,
        defaultMode: labDefaultMode,
        category,
        rateLimitRpm: body.rateLimitRpm,
        tokenBudgetDaily: body.tokenBudgetDaily,
        spendCapDailyCents: body.spendCapDailyCents,
        budgetScope: body.budgetScope,
        expiresAt: body.expiresAt,
        ipAllowlist: body.ipAllowlist,
        requestCapDaily: body.requestCapDaily,
      },
    });

    if (minted.status !== 201) {
      const status = minted.status === 500 ? 500 : 400;
      return NextResponse.json({ error: minted.detail || minted.error || "Failed to create key" }, { status });
    }

    const { key, keyId, keyPrefix, record, meta } = minted.envelope;
    return NextResponse.json({
      key, // one-time full key — shown only here
      keyId,
      keyPrefix,
      record,
      meta,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating key:", error?.message || error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
