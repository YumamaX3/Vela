import { NextResponse } from "next/server";
import { deleteWithScrub, revokeApiKey, getApiKeyById, updateApiKey, KeyLimitsValidationError, sanitizeCategory } from "@/lib/localDb";
import { rotateKey } from "@/lib/keys/mintService.js";
// W0 ledger seam (Key Domain Ascension): previously-silent mutation surfaces
// (pause/resume/expire-set/edit/revoke/delete) now write audit rows through
// ONE chokepoint. Fail-open — an audit failure never fails the mutation.
import { recordMutation, classifyPutSurface, summarizeUpdate } from "@/lib/keys/mutationLedger.js";

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
    console.error("Error fetching key:", error?.message || error);
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

    // Rotate: revoke+mint with lineage through the SINGLE chokepoint
    // (rotateKey) — write-before-commit reveal-sink, S4 rotation-grace
    // (predecessorHash captured from the RAW row), append-only ledger. The
    // new key rides the 201 show-once contract — never returned again.
    if (body.action === "rotate") {
      const rotated = await rotateKey(existing);
      if (rotated.status !== 201) {
        return NextResponse.json({ error: rotated.detail || rotated.error || "Failed to rotate key" }, { status: rotated.status === 500 ? 500 : 400 });
      }
      const { key, keyId, keyPrefix, record, meta } = rotated.envelope;
      return NextResponse.json({
        key,
        keyId,
        keyPrefix,
        record,
        rotatedFrom: existing.id,
        meta,
      }, { status: 201 });
    }

    // Revoke (lifecycle split, §1.3) — the row stays VISIBLE with its history
    // (deletedAt NULL), the hash is purged. Distinct from DELETE (tombstone
    // + tag scrub). No new key material is minted.
    if (body.action === "revoke") {
      const revoked = await revokeApiKey(id);
      if (!revoked) {
        return NextResponse.json({ error: "Key not found" }, { status: 404 });
      }
      await recordMutation({ request, surface: "revoke", keyId: id, outcome: "revoked_hash_purged" });
      return NextResponse.json({ message: "Key revoked" });
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
    for (const aclField of ["allowedModels", "allowedKinds", "allowedProviders", "allowedCombos", "allowedModes", "allowedInjectors"]) {
      if (body[aclField] !== undefined) {
        if (body[aclField] != null) {
          if (!Array.isArray(body[aclField]) || body[aclField].some((m) => typeof m !== "string" || !m.trim())) {
            return NextResponse.json({ error: `${aclField} must be an array of strings (or null for unrestricted)` }, { status: 400 });
          }
          updateData[aclField] = [...new Set(body[aclField].map((m) => m.trim()))];
        } else {
          updateData[aclField] = null; // unrestricted
        }
      }
    }
    // AI Lab (migration 017): defaultMode — a single mode name, or null to clear.
    if (body.defaultMode !== undefined) {
      if (body.defaultMode != null && typeof body.defaultMode !== "string") {
        return NextResponse.json({ error: "defaultMode must be a string (a mode name) or null" }, { status: 400 });
      }
      updateData.defaultMode = body.defaultMode ? body.defaultMode.trim() || null : null;
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
    // W0 ledger seam: the PUT path is the most-used mutation surface — name
    // the op honestly (pause/resume/expire-set/edit) and record WHICH fields
    // changed (never their values; ACL/IP fields are opaque by design).
    await recordMutation({
      request,
      surface: classifyPutSurface(updateData),
      keyId: id,
      outcome: "updated",
      detail: summarizeUpdate(updateData),
    });
    return NextResponse.json({ key: updated });
  } catch (error) {
    if (error instanceof KeyLimitsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error updating key:", error?.message || error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] — delete-with-scrub (lifecycle split, §1.3): soft
// tombstone + tag purge in ONE transaction (Covenant M5). The audit row
// survives (deletedAt set) but is hidden from default views.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteWithScrub(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    // W0 ledger seam: key destruction is the highest-risk mutation — the row
    // survives (tombstoned), the hash is scrubbed, tags purged in-transaction.
    await recordMutation({ request, surface: "delete", keyId: id, outcome: "deleted_scrubbed" });

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.error("Error deleting key:", error?.message || error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
