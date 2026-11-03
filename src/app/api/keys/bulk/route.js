import { NextResponse } from "next/server";
import {
  getApiKeys,
  getApiKeyById,
  updateApiKey,
  deleteApiKey,
  KeyLimitsValidationError,
} from "@/lib/localDb";
import { validateKeyLimits } from "@/lib/db/keyLimits.js";
import { readJsonBody } from "../_lib/keysApi.js";
import { runPool } from "@/shared/utils/boundedPool.js";
import * as log from "@/sse/utils/logger.js";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;
// The current's width — see keys/import/route.js APPLY_CONCURRENCY for why six.
const BULK_CONCURRENCY = 6;
const ACTIONS = ["pause", "resume", "delete", "setCategory", "setLimits"];

// POST /api/keys/bulk
// One door for the fleet operations that would otherwise be N requests, and the
// ones no client could do honestly at all (apply one category or one limit set
// across a selection). Every target gets its OWN verdict — a partial success is
// reported as exactly that, never as a blanket "ok".
//
// Posture note: this route is no more powerful than the per-id routes it
// replaces. PUT/DELETE /api/keys/[id] already sit on the deny-by-default
// /api/* branch, and bulk applies the same operations, N times, at the same
// posture — so it inherits that branch rather than inventing a new trust level.
//
// Body: { action, ids?: string[], names?: string[], category?: string|null,
//         limits?: { rateLimitRpm?, rateLimitTpm?, rateLimitRph?, rateLimitRpd?,
//                    maxConcurrentRequests?, tokenBudgetDaily?, spendCapDailyCents?,
//                    budgetScope?, expiresAt?, ipAllowlist? } }
// Reply: { action, changed, failed, results: [{ id?, name, ok, error? }] }
export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const action = body.action;

    if (!ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Unknown action "${action}" — expected one of ${ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean).map(String) : [];
    const names = Array.isArray(body.names) ? body.names.filter(Boolean).map(String) : [];
    if (ids.length > MAX_ITEMS || names.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Too many items in one call (max ${MAX_ITEMS})` }, { status: 400 });
    }
    if (ids.length === 0 && names.length === 0) {
      return NextResponse.json({ error: "No keys selected — send ids and/or names" }, { status: 400 });
    }

    // A limits patch is judged ONCE, before any row is touched: an invalid
    // ceiling is a caller error, not a per-key story, and reporting it 200
    // times would bury the one sentence that matters.
    if (action === "setLimits") {
      const verdict = validateKeyLimits(body.limits || {});
      if (!verdict.ok) {
        return NextResponse.json({ error: verdict.errors.join("; "), errors: verdict.errors }, { status: 400 });
      }
    }

    const all = await getApiKeys();
    const byId = new Map(all.map((k) => [k.id, k]));
    // Names are NOT unique in this harbor (the create path never enforced it),
    // so an ambiguous name is reported as such rather than resolved by guess.
    const byName = new Map();
    for (const k of all) {
      if (!byName.has(k.name)) byName.set(k.name, []);
      byName.get(k.name).push(k);
    }

    // One ordered lane: every selection slot fills ONE cell of the reply, in
    // SELECTION order. A resolved key's slot rides the pool (which returns its
    // verdicts aligned to its own input order, whatever the writes interleave);
    // a miss or an ambiguous name carries its verdict inline. Pushing misses
    // into `results` before `...verdicts` would hoist them above every applied
    // key and reorder the reply the operator reads.
    const slots = [];
    const seen = new Set();

    const push = (key, fallbackId) => {
      const identity = key?.id || fallbackId;
      if (identity && seen.has(identity)) return;
      if (identity) seen.add(identity);
      slots.push(key || { id: fallbackId, name: fallbackId });
    };

    for (const id of ids) {
      const key = byId.get(id);
      if (key) push(key, id);
      else slots.push({ id, name: null, ok: false, error: "Key not found" });
    }
    for (const name of names) {
      const matches = byName.get(name) || [];
      if (matches.length === 1) push(matches[0]);
      else if (matches.length === 0) slots.push({ name, ok: false, error: "Key not found" });
      else slots.push({ name, ok: false, error: `Name is ambiguous — ${matches.length} keys share it; select by id` });
    }

    const targets = slots.filter((s) => !Object.prototype.hasOwnProperty.call(s, "ok"));

    if (targets.length === 0) {
      // Nothing to apply — but the ordered lane still reports every miss and
      // ambiguous name it resolved (the old shape emptied results here too,
      // swallowing refusals when the selection was all misses).
      const results = slots.filter((s) => Object.prototype.hasOwnProperty.call(s, "ok"));
      return NextResponse.json({
        action,
        changed: 0,
        failed: results.length,
        results,
      });
    }

    // One verdict per target, at most BULK_CONCURRENCY in flight. The pool
    // returns verdicts aligned to its input order; the ordered-lane map below
    // is what keeps the reply reading as the selection did.
    const verdicts = await runPool(
      targets,
      async (key) => {
        try {
          if (action === "delete") {
            const ok = await deleteApiKey(key.id);
            if (ok) return { id: key.id, name: key.name, ok: true };
            return { id: key.id, name: key.name, ok: false, error: "Already revoked" };
          }

          let patch;
          if (action === "pause") patch = { isActive: false };
          else if (action === "resume") patch = { isActive: true };
          else if (action === "setCategory") patch = { category: body.category ?? null };
          // The limits patch is applied as the NORMALIZED values the one-time
          // verdict produced — null stays null only where the caller said so,
          // and every field the caller omitted is absent from the patch (a
          // bulk "set these ceilings" must not silently clear the others).
          else patch = { ...(body.limits || {}) };

          const updated = await updateApiKey(key.id, patch);
          if (updated) return { id: key.id, name: key.name, ok: true };
          return { id: key.id, name: key.name, ok: false, error: "Update failed" };
        } catch (error) {
          const message = error instanceof KeyLimitsValidationError ? error.message : (error?.message || "Update failed");
          return { id: key.id, name: key.name, ok: false, error: message };
        }
      },
      { concurrency: BULK_CONCURRENCY }
    );

    const verdictById = new Map(verdicts.map((v) => [v.id, v]));
    const results = slots.map((s) =>
      Object.prototype.hasOwnProperty.call(s, "ok") ? s : verdictById.get(s.id)
    );
    const changed = verdicts.filter((v) => v.ok).length;

    return NextResponse.json({
      action,
      changed,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (error) {
    log.info("KEYS", "Error in bulk key operation:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to apply bulk key operation" }, { status: 500 });
  }
}
