import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey, KeyLimitsValidationError, sanitizeCategory } from "@/lib/localDb";

// GET /api/keys/[id] — masked row (never the full key)
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] — whitelist-only mutation. W1: name, description,
// allowedModels, isActive. W3: rateLimitRpm, tokenBudgetDaily,
// spendCapDailyCents, budgetScope, expiresAt, ipAllowlist (validated by the
// repo — invalid values → 400 with every problem named). Security columns
// are never writable through this path (repo enforces).
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      }
      updateData.name = body.name.trim();
    }
    if (body.description !== undefined) {
      updateData.description = typeof body.description === "string" ? body.description.trim() || null : null;
    }
    if (body.allowedModels !== undefined) {
      if (body.allowedModels != null) {
        if (!Array.isArray(body.allowedModels) || body.allowedModels.some((m) => typeof m !== "string" || !m.trim())) {
          return NextResponse.json({ error: "allowedModels must be an array of model ids (or null for unrestricted)" }, { status: 400 });
        }
        updateData.allowedModels = [...new Set(body.allowedModels.map((m) => m.trim()))];
      } else {
        updateData.allowedModels = null; // unrestricted
      }
    }
    if (body.isActive !== undefined) updateData.isActive = !!body.isActive;
    if (body.category !== undefined) {
      // null or empty-string clears the category (back to "Uncategorized").
      try {
        updateData.category = sanitizeCategory(body.category);
      } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
    }
    // W3 governance fields pass through as-is — the repo validates shape,
    // range, scope membership, expiry-future, and CIDR syntax.
    for (const f of ["rateLimitRpm", "tokenBudgetDaily", "spendCapDailyCents", "budgetScope", "expiresAt", "ipAllowlist"]) {
      if (body[f] !== undefined) updateData[f] = body[f];
    }

    if (!Object.keys(updateData).length) {
      return NextResponse.json({ key: existing });
    }

    const updated = await updateApiKey(id, updateData);
    if (!updated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: updated });
  } catch (error) {
    if (error instanceof KeyLimitsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] — soft-revoke (audit row kept; hash NULLed)
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
