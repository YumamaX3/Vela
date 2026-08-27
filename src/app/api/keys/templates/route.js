import { NextResponse } from "next/server";
import { listTemplates, createTemplate } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/templates — the saved key-configuration presets (Governance
 * Center, W1b). Built-ins included by default (?includeBuiltIn=false strips
 * them). Shapes carry acl/limits config ONLY — never secret material.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeBuiltIn = searchParams.get("includeBuiltIn") !== "false";
    const templates = await listTemplates({ includeBuiltIn });
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("[API] Failed to list key templates:", error);
    return NextResponse.json({ templates: [] });
  }
}

/**
 * POST /api/keys/templates — create a saved preset. `acl`/`limits` are
 * configuration shapes (never secrets); the repo validates name uniqueness +
 * length. Built-in rows are immutable (repo-enforced).
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { name, description, acl, limits, categoryDefault } = body || {};

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }

    const result = await createTemplate({
      name: name.trim(),
      description: typeof description === "string" ? description.trim() || null : null,
      acl: acl && typeof acl === "object" ? acl : null,
      limits: limits && typeof limits === "object" ? limits : null,
      categoryDefault: typeof categoryDefault === "string" ? categoryDefault.trim() || null : null,
    });

    if (result && result.error) {
      const status = result.error.includes("already exists") ? 409 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ template: result }, { status: 201 });
  } catch (error) {
    console.error("[API] Failed to create key template:", error);
    return NextResponse.json({ error: "Failed to create key template" }, { status: 500 });
  }
}
