/**
 * mintKey — the single chokepoint over SIX mint surfaces (Endpoint Observatory
 * W1c, Shorekeeper-Sealed Plan §1.4/§2.1-2.2).
 *
 * Surfaces: create · rotate · duplicate · revive · import-mint ·
 * template-apply. Everything that generates key material converges here.
 * mintKey owns BOTH the 201 envelope shape AND the reveal-sink write, so the
 * show-once covenant has exactly one writer and one sink (single-writer law).
 *
 * Ordering invariants (Covenant C10 + A1):
 *   1. reveal-sink write STRICTLY BEFORE the DB commit — a committed row can
 *      never outlive its plaintext carrier.
 *   2. on post-commit sink failure → auto-revoke the minted row and report
 *      error code created_unrevealable_revoked (the batch/import vocabulary).
 *   3. the append-only key-mutation ledger entry rides every mint (S3).
 *
 * The envelope is byte-identical across all six surfaces (minus volatiles):
 *   { status: 201, envelope: { key, keyId, keyPrefix, record, meta } }
 */

import { generateApiKey } from "@/shared/utils/apiKey.js";
import { writeReveal } from "./revealSink.js";
import {
  createApiKey,
  revokeApiKey,
  getApiKeyById,
  KeyLimitsValidationError,
} from "@/lib/db/index.js";
import { appendLedger } from "@/lib/db/index.js";

/** Mint a fresh key through the unified service. */
export async function mintKey({ name, opts = {}, surface = "create", actorClass = "dashboard", sourceRowId = null }) {
  // 1. Generate the credential (hash-at-rest: plaintext exists in-flight only).
  const keyFields = generateApiKey();
  const { key, keyId, keyPrefix } = keyFields;

  // 2. SINK WRITE FIRST — before any DB work (Covenant C10). If this throws,
  //    the mint aborts cleanly: no row, no orphan.
  let reveal;
  try {
    reveal = await writeReveal({ keyId, keyPrefix, key, actorKind: surface });
  } catch (e) {
    return {
      status: 500,
      error: "reveal_sink_unavailable",
      detail: e.message,
    };
  }

  // 3. DB commit — keyFields rides through so the committed row carries the
  //    EXACT credential that was revealed (never a second, unrevealed one).
  let record;
  try {
    const created = await createApiKey(name, { ...opts, keyFields });
    record = created.record || created;
  } catch (e) {
    // Row never committed — the orphan reveal is swept by TTL. Honest report.
    // A KeyLimitsValidationError carries the operator's own message (the
    // whitelist rejected the governance values) — surface it verbatim.
    if (e instanceof KeyLimitsValidationError) {
      return { status: 400, error: "mint_failed", detail: e.message, validation: true };
    }
    return {
      status: 400,
      error: "mint_failed",
      detail: e.message,
    };
  }

  // 4. Ledger attribution (S3) — best-effort, never fails the mint.
  try {
    await appendLedger({
      surface,
      keyId,
      sourceRowId,
      outcome: "minted",
      actorClass,
      detail: reveal ? reveal.revealId : null,
    });
  } catch {}

  return {
    status: 201,
    envelope: {
      key, // one-time plaintext — crosses HTTP once, exists nowhere after
      keyId,
      keyPrefix,
      record,
      meta: {
        surface,
        revealId: reveal ? reveal.revealId : null,
        actorClass,
        keyVersion: "v1",
      },
    },
  };
}

/**
 * Rotate — revoke-old + insert-new as ONE adapter transaction (Covenant S5)
 * with the S4 grace repair: the old row's keyHash is copied into the
 * successor's rotationPrevHash BEFORE the purge so resolveKey's grace clause
 * can match. The sink write happens before the transaction (C10).
 */
export async function rotateKey(existing, actorClass = "dashboard") {
  // Sink write FIRST (C10).
  const { key, keyId, keyHash, keyPrefix } = generateApiKey();
  let reveal;
  try {
    reveal = await writeReveal({ keyId, keyPrefix, key, actorKind: "rotate" });
  } catch (e) {
    return { status: 500, error: "reveal_sink_unavailable", detail: e.message };
  }

  const now = new Date().toISOString();
  const ROTATION_GRACE_MS = 72 * 3600_000;
  const grace = new Date(Date.now() + ROTATION_GRACE_MS).toISOString();

  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();

  // S4 grace repair — the predecessor's keyHash is NOT on the public
  // projection (rowToPublic hides it by design). Fetch the raw row so the
  // successor's rotationPrevHash carries a REAL hash; resolveKey's grace
  // clause can only match a real hash, never undefined/NULL.
  const raw = db.get(`SELECT keyHash FROM apiKeys WHERE id = ?`, [existing.id]);
  const predecessorHash = raw?.keyHash ?? null;

  let record;
  try {
    db.transaction(() => {
      db.run(
        `UPDATE apiKeys SET isActive = 0, keyHash = NULL, rotatedFrom = NULL, rotationPrevKeyId = ?, rotationGraceUntil = NULL WHERE id = ?`,
        [keyId, existing.id]
      );
      db.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, allowedKinds, allowedProviders, allowedCombos, allowedInjectors, allowedModes, defaultMode, isInternal, rateLimitRpm, tokenBudgetDaily, spendCapDailyCents, budgetScope, expiresAt, ipAllowlist, category, rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil)
         VALUES(?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          keyId,
          `vela-minted-${keyId}`,
          existing.name || "Rotated API Key",
          null,
          now,
          "v1",
          keyHash,
          keyPrefix,
          existing.description || null,
          existing.allowedModels != null ? JSON.stringify(existing.allowedModels) : null,
          existing.allowedKinds != null ? JSON.stringify(existing.allowedKinds) : null,
          existing.allowedProviders != null ? JSON.stringify(existing.allowedProviders) : null,
          existing.allowedCombos != null ? JSON.stringify(existing.allowedCombos) : null,
          existing.allowedInjectors != null ? JSON.stringify(existing.allowedInjectors) : null,
          existing.allowedModes != null ? JSON.stringify(existing.allowedModes) : null,
          existing.defaultMode || null,
          existing.rateLimitRpm ?? null,
          existing.tokenBudgetDaily ?? null,
          existing.spendCapDailyCents ?? null,
          existing.budgetScope || null,
          existing.expiresAt || null,
          existing.ipAllowlist != null ? JSON.stringify(existing.ipAllowlist) : null,
          existing.category || null,
          existing.id,     // rotatedFrom — lineage to the old row
          predecessorHash, // S4 — the OLD token's hash, so grace can match
          existing.id,     // rotationPrevKeyId — the token being replaced
          grace,           // rotationGraceUntil — old token stays resolvable until then
        ]
      );
    });
    record = await getApiKeyById(keyId);
  } catch (e) {
    return { status: 500, error: "rotate_failed", detail: e.message };
  }

  try {
    await appendLedger({
      surface: "rotate",
      keyId,
      sourceRowId: existing.id,
      outcome: "rotated",
      actorClass,
      detail: reveal ? reveal.revealId : null,
    });
  } catch {}

  return {
    status: 201,
    envelope: { key, keyId, keyPrefix, record, meta: { surface: "rotate", revealId: reveal ? reveal.revealId : null, actorClass, keyVersion: "v1" } },
  };
}

/** Auto-revoke a minted-but-unrevealable row (created_unrevealable_revoked). */
export async function revokeUnrevealable(keyId) {
  try {
    await revokeApiKey(keyId);
    return true;
  } catch {
    return false;
  }
}
