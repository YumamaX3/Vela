import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey, KeyLimitsValidationError, sanitizeCategory } from "@/lib/localDb";
import { generateApiKey } from "@/shared/utils/apiKey";
import { getAdapter } from "@/lib/db/driver.js";

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

    // Rotate: revoke+mint with lineage. The OLD row is paused, its hash
    // purged, and its rotation columns stamped; the NEW row inherits every
    // governance field (limits/ACL/category) and carries rotatedFrom = old id.
    // The new key rides the 201 show-once contract — never returned again.
    if (body.action === "rotate") {
      const created = await rotateApiKey(existing, body);
      if (created.error) {
        return NextResponse.json({ error: created.error }, { status: 400 });
      }
      return NextResponse.json(created.payload, { status: 201 });
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
    for (const aclField of ["allowedModels", "allowedKinds", "allowedProviders", "allowedCombos"]) {
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
    console.error("Error updating key:", error?.message || error);
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
    console.error("Error deleting key:", error?.message || error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}

const ROTATION_GRACE_MS = 72 * 3600_000;

/**
 * Revoke the existing key and mint its successor in one transaction.
 * rotationPrevHash + rotationGraceUntil on the new row keep the OLD token
 * resolvable for a 72h grace window (resolveKey honors the slot) while the
 * old row itself is paused and hash-purged. isActive is NOT inherited — a
 * rotated key starts active by design.
 */
async function rotateApiKey(existing, body) {
  try {
    const { key, keyId, keyHash, keyPrefix } = generateApiKey();
    const now = new Date().toISOString();
    const grace = new Date(Date.now() + ROTATION_GRACE_MS).toISOString();

    const db = await getAdapter();
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ? AND isInternal = 0 AND deletedAt IS NULL`, [existing.id]);
    if (!row) return { error: "Key not found" };

    const createdAt = now;
    db.transaction(() => {
      // Old row: pause, purge hash, stamp lineage.
      db.run(
        `UPDATE apiKeys SET isActive = 0, keyHash = NULL, rotatedFrom = NULL, rotationPrevKeyId = ?, rotationGraceUntil = NULL WHERE id = ?`,
        [keyId, existing.id]
      );
      // New row: inherit every governance field, carry the lineage.
      db.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, allowedKinds, allowedProviders, allowedCombos, isInternal, rateLimitRpm, tokenBudgetDaily, spendCapDailyCents, budgetScope, expiresAt, ipAllowlist, category, rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil)
         VALUES(?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          keyId,
          `vela-minted-${keyId}`,
          existing.name || "Rotated API Key",
          null,
          createdAt,
          "v1",
          keyHash,
          keyPrefix,
          existing.description || null,
          existing.allowedModels != null ? JSON.stringify(existing.allowedModels) : null,
          existing.allowedKinds != null ? JSON.stringify(existing.allowedKinds) : null,
          existing.allowedProviders != null ? JSON.stringify(existing.allowedProviders) : null,
          existing.allowedCombos != null ? JSON.stringify(existing.allowedCombos) : null,
          existing.rateLimitRpm ?? null,
          existing.tokenBudgetDaily ?? null,
          existing.spendCapDailyCents ?? null,
          existing.budgetScope || null,
          existing.expiresAt || null,
          existing.ipAllowlist != null ? JSON.stringify(existing.ipAllowlist) : null,
          existing.category || null,
          existing.id,             // rotatedFrom — lineage to the old row
          null,                    // rotationPrevHash — a fresh key has no predecessor of its own
          existing.id,             // rotationPrevKeyId — the token being replaced
          grace,                   // rotationGraceUntil — old token stays resolvable until then
        ]
      );
    });

    const record = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [keyId]);
    return {
      payload: {
        key, // one-time plaintext — show-once contract
        keyId,
        keyPrefix,
        record: {
          id: record.id,
          name: record.name,
          description: record.description || null,
          keyPrefix: record.keyPrefix || null,
          allowedModels: safeParse(record.allowedModels),
          allowedKinds: safeParse(record.allowedKinds),
          allowedProviders: safeParse(record.allowedProviders),
          allowedCombos: safeParse(record.allowedCombos),
          isActive: true,
          isInternal: false,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt || null,
          lastUsedAt: null,
          rotatedFrom: record.rotatedFrom || null,
          tokenBudgetDaily: record.tokenBudgetDaily ?? null,
          spendCapDailyCents: record.spendCapDailyCents ?? null,
          budgetScope: record.budgetScope || null,
          rateLimitRpm: record.rateLimitRpm ?? null,
          ipAllowlist: safeParse(record.ipAllowlist),
          category: record.category || null,
        },
        rotatedFrom: existing.id,
      },
    };
  } catch (error) {
    console.error("[API] Rotate failed:", error);
    return { error: error.message || "Failed to rotate key" };
  }
}

function safeParse(v) {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
