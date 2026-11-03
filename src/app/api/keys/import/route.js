import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, updateApiKey, KeyLimitsValidationError } from "@/lib/localDb";
import { validateKeyLimits } from "@/lib/db/keyLimits.js";
import { EXPORT_ENVELOPE, readJsonBody, uniqueName } from "../_lib/keysApi.js";
import { runPool } from "@/shared/utils/boundedPool.js";
import * as log from "@/sse/utils/logger.js";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;
// The apply current's width. Each accepted row is its own write, so the only
// reason to cap it is the writer underneath — SQLite serializes writes, and a
// wider pool just queues more of them at the same lock. Six keeps the round
// trips overlapping without stretching the single-writer queue.
const APPLY_CONCURRENCY = 6;
const CONFLICT_MODES = ["skip", "overwrite", "rename"];
// The governance fields an imported entry may carry. Everything else in the
// file is ignored by construction — an imported document is untrusted input
// even when it was exported from this same harbor yesterday.
const IMPORTABLE = [
  "description", "category", "allowedModels", "allowedKinds", "allowedProviders",
  "allowedCombos", "rateLimitRpm", "rateLimitTpm", "rateLimitRph", "rateLimitRpd",
  "maxConcurrentRequests", "tokenBudgetDaily", "spendCapDailyCents",
  "budgetScope", "expiresAt", "ipAllowlist",
];

// POST /api/keys/import
//
// ⚠️ THE ONE HONEST LIMIT, stated before anything else: a key string CANNOT be
// restored. Keys are hash-at-rest and show-once — the plaintext stops existing
// server-side the moment its 201 leaves — so applying an import MINTS NEW
// CREDENTIALS for every entry it accepts. The response carries each new
// plaintext exactly once (the same show-once ceremony the single-key create
// route performs, N times), and that is the only moment it will ever exist.
// An import is therefore a re-issue, never a restore, and the operator must
// save the returned keys or the entries are dead on arrival.
//
// The dry run is the point of this route: `mode` defaults to "dry-run", which
// writes NOTHING and answers the exact plan it would execute — each entry's
// verdict, each collision's resolution, each invalid field's reason.
//
// Body: { mode?: "dry-run"|"apply", onConflict?: "skip"|"overwrite"|"rename",
//         envelope: { app: "vela-keys", keys: [...] } } — or the file itself.
export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const file = body.envelope || body;
    const mode = body.mode === "apply" ? "apply" : "dry-run";
    const onConflict = CONFLICT_MODES.includes(body.onConflict) ? body.onConflict : "skip";

    if (!file || file.app !== EXPORT_ENVELOPE || !Array.isArray(file.keys)) {
      return NextResponse.json(
        { error: `Not a ${EXPORT_ENVELOPE} document — expected { app: "${EXPORT_ENVELOPE}", keys: [...] }` },
        { status: 400 }
      );
    }
    if (file.keys.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Too many keys in one import (max ${MAX_ITEMS})` }, { status: 400 });
    }

    const existing = await getApiKeys();
    const byName = new Map(existing.map((k) => [k.name, k]));
    const taken = new Set(existing.map((k) => k.name));

    const invalid = [];
    const plan = [];
    const accepted = [];

    for (const entry of file.keys) {
      const rawName = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!rawName) {
        invalid.push({ name: null, error: "Entry has no name" });
        continue;
      }

      // Judge the ceilings exactly as the write path will, so the plan cannot
      // promise an entry the repo would then refuse.
      const limitsInput = {};
      for (const f of ["rateLimitRpm", "rateLimitTpm", "rateLimitRph", "rateLimitRpd", "maxConcurrentRequests", "tokenBudgetDaily", "spendCapDailyCents", "budgetScope", "expiresAt", "ipAllowlist"]) {
        if (entry[f] !== undefined && entry[f] !== null) limitsInput[f] = entry[f];
      }
      const verdict = validateKeyLimits(limitsInput);
      if (!verdict.ok) {
        invalid.push({ name: rawName, error: verdict.errors.join("; ") });
        continue;
      }

      const collision = byName.get(rawName);
      let action;
      let targetName = rawName;

      if (collision) {
        if (onConflict === "skip") action = "skip";
        else if (onConflict === "overwrite") action = "update";
        else {
          targetName = uniqueName(taken, rawName);
          if (!targetName) {
            invalid.push({ name: rawName, error: "No free name available (100 suffixed variants taken)" });
            continue;
          }
          action = "create";
        }
      } else {
        action = "create";
      }

      if (action !== "skip") taken.add(targetName);

      const patch = {};
      for (const f of IMPORTABLE) {
        if (entry[f] !== undefined) patch[f] = entry[f];
      }

      const row = { name: rawName, targetName, action, patch, limits: verdict.values };
      if (action === "update") row.id = collision.id;
      plan.push({ name: rawName, action, targetName: action === "update" ? null : targetName });
      if (action !== "skip") accepted.push(row);
    }

    const summary = {
      create: plan.filter((p) => p.action === "create").length,
      update: plan.filter((p) => p.action === "update").length,
      skip: plan.filter((p) => p.action === "skip").length,
      invalid: invalid.length,
    };

    // ── the dry run stops here, having written nothing ──────────────────────
    if (mode === "dry-run") {
      return NextResponse.json({ mode, onConflict, summary, invalid, plan });
    }

    // The show-once ledger. It is written by the workers themselves, the
    // instant each minted plaintext exists — never reconstructed afterwards —
    // so worker k's entry lands before any later worker can throw. Each push
    // records its input index and the list is re-sorted below: concurrent
    // completion must not reorder the reveal.
    const created = [];

    // ── apply ───────────────────────────────────────────────────────────────
    // Six mints at a time, not two hundred: each accepted row is an independent
    // write, so the pool runs them with at most APPLY_CONCURRENCY in flight —
    // and `results[i]` is always `accepted[i]`'s verdict, whatever order the
    // writes land in. The per-entry dialect (a limits error's own sentence, or
    // "Create failed") stays HERE, in the worker, because the pool only knows
    // that something threw, not what the harbor calls it.
    const verdicts = await runPool(
      accepted,
      async (row, index) => {
        try {
          if (row.action === "update") {
            const next = await updateApiKey(row.id, {
              ...row.patch,
              // An explicit null must be able to CLEAR a ceiling, so overwrite
              // carries the whole shape rather than only the keys present.
              ...Object.fromEntries(
                ["rateLimitRpm", "rateLimitTpm", "rateLimitRph", "rateLimitRpd", "maxConcurrentRequests", "tokenBudgetDaily", "spendCapDailyCents", "budgetScope", "expiresAt", "ipAllowlist"]
                  .map((f) => [f, row.limits[f] ?? null])
              ),
            });
            if (next) {
              return {
                verdict: { name: row.name, ok: true, action: "overwrite" },
                updated: { id: next.id, name: next.name },
              };
            }
            return { verdict: { name: row.name, ok: false, error: "Update failed" } };
          }

          const minted = await createApiKey(row.targetName, {
            ...row.patch,
            rateLimitRpm: row.limits.rateLimitRpm ?? null,
            rateLimitTpm: row.limits.rateLimitTpm ?? null,
            rateLimitRph: row.limits.rateLimitRph ?? null,
            rateLimitRpd: row.limits.rateLimitRpd ?? null,
            maxConcurrentRequests: row.limits.maxConcurrentRequests ?? null,
            tokenBudgetDaily: row.limits.tokenBudgetDaily ?? null,
            spendCapDailyCents: row.limits.spendCapDailyCents ?? null,
            budgetScope: row.limits.budgetScope ?? undefined,
            expiresAt: row.limits.expiresAt ?? null,
            ipAllowlist: row.limits.ipAllowlist ?? null,
          });
          // The plaintext rides this response exactly once — the show-once
          // ceremony, N times. It is never stored and never returned again. It
          // is captured HERE, inside the worker, the moment it exists, so a
          // throwing sibling can never cost a minted key its only reveal.
          created.push({ _index: index, name: row.targetName, keyId: minted.keyId, key: minted.key });
          return {
            verdict: { name: row.name, ok: true, action: "add", targetName: row.targetName },
            created: true,
          };
        } catch (error) {
          const message = error instanceof KeyLimitsValidationError ? error.message : (error?.message || "Create failed");
          return { verdict: { name: row.name, ok: false, error: message } };
        }
      },
      { concurrency: APPLY_CONCURRENCY }
    );

    // Reduce in INPUT order — so the response's results, created and updated
    // lists read exactly as the file did, and `changed` is the same number the
    // sequential loop would have reached.
    const results = verdicts.map((v) => v.verdict);
    const updated = verdicts.filter((v) => v.updated).map((v) => v.updated);
    const changed = verdicts.filter((v) => v.verdict.ok).length;
    created.sort((a, b) => a._index - b._index);
    for (const entry of created) delete entry._index;

    return NextResponse.json({
      mode,
      onConflict,
      summary,
      invalid,
      plan,
      applied: { changed, created, updated, results },
    });
  } catch (error) {
    log.info("KEYS", "Error importing keys:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to import keys" }, { status: 500 });
  }
}
