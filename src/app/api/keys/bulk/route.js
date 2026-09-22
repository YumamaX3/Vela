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

export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;
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
//         limits?: { rateLimitRpm?, tokenBudgetDaily?, spendCapDailyCents?,
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

    const results = [];
    const targets = [];
    const seen = new Set();

    const push = (key, fallbackId) => {
      const identity = key?.id || fallbackId;
      if (identity && seen.has(identity)) return;
      if (identity) seen.add(identity);
      targets.push(key || { id: fallbackId, name: fallbackId });
    };

    for (const id of ids) {
      const key = byId.get(id);
      if (key) push(key, id);
      else results.push({ id, name: null, ok: false, error: "Key not found" });
    }
    for (const name of names) {
      const matches = byName.get(name) || [];
      if (matches.length === 1) push(matches[0]);
      else if (matches.length === 0) results.push({ name, ok: false, error: "Key not found" });
      else results.push({ name, ok: false, error: `Name is ambiguous — ${matches.length} keys share it; select by id` });
    }

    if (targets.length === 0 && results.length === 0) {
      return NextResponse.json({ action, changed: 0, failed: 0, results: [] });
    }

    let changed = 0;
    for (const key of targets) {
      try {
        if (action === "delete") {
          const ok = await deleteApiKey(key.id);
          if (ok) { changed += 1; results.push({ id: key.id, name: key.name, ok: true }); }
          else results.push({ id: key.id, name: key.name, ok: false, error: "Already revoked" });
          continue;
        }

        let patch;
        if (action === "pause") patch = { isActive: false };
        else if (action === "resume") patch = { isActive: true };
        else if (action === "setCategory") patch = { category: body.category ?? null };
        else patch = { ...(body.limits || {}) };

        const updated = await updateApiKey(key.id, patch);
        if (updated) { changed += 1; results.push({ id: key.id, name: key.name, ok: true }); }
        else results.push({ id: key.id, name: key.name, ok: false, error: "Update failed" });
      } catch (error) {
        const message = error instanceof KeyLimitsValidationError ? error.message : (error?.message || "Update failed");
        results.push({ id: key.id, name: key.name, ok: false, error: message });
      }
    }

    return NextResponse.json({
      action,
      changed,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (error) {
    console.log("Error in bulk key operation:", error);
    return NextResponse.json({ error: "Failed to apply bulk key operation" }, { status: 500 });
  }
}
