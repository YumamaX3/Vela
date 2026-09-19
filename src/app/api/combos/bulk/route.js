import { NextResponse } from "next/server";
import {
  getCombos,
  getComboById,
  getSettings,
  createCombo,
  updateCombo,
  deleteCombo,
  updateSettings,
} from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import { validateComboName } from "@/shared/constants/comboValidation";
import {
  isLlmCombo,
  mergeComboStrategy,
  normalizeModels,
  parseComboKind,
  readJsonBody,
  renamespaceName,
  uniqueCopyName,
} from "../_lib/combosApi.js";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;
const ACTIONS = ["delete", "duplicate", "setStrategy", "renameNamespace"];

// POST /api/combos/bulk
// One route for the fleet operations the cards used to run one request at a
// time (duplicate, delete) plus the ones no client could do honestly at all
// (strategy rewrite, namespace rewrite). Every item gets its own verdict —
// a partial success is reported as exactly that, never as a blanket "ok".
//
// Body: { action, ids?: string[], names?: string[], strategy?, judgeModel?,
//         prefix?, nextPrefix? }
// Reply: { action, changed, results: [{ name, ok, error?, newName? }] }
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
      return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
    }

    const combos = (await getCombos()) || [];
    const byId = new Map(combos.map((c) => [c.id, c]));
    const byName = new Map(combos.map((c) => [c.name, c]));

    // Resolve the selection to combos, in selection order, skipping unknown ids.
    const selected = [];
    const results = [];
    for (const id of ids) {
      const combo = byId.get(id);
      if (!combo) results.push({ id, ok: false, error: "Combo not found" });
      else selected.push(combo);
    }
    for (const name of names) {
      const combo = byName.get(name);
      if (!combo) results.push({ name, ok: false, error: "Combo not found" });
      else selected.push(combo);
    }

    if (selected.length === 0) {
      return NextResponse.json({ action, changed: 0, results }, { status: 404 });
    }

    // ── delete ────────────────────────────────────────────────────────────
    if (action === "delete") {
      let changed = 0;
      for (const combo of selected) {
        const ok = await deleteCombo(combo.id);
        if (ok) {
          resetComboRotation(combo.name);
          changed += 1;
          results.push({ name: combo.name, ok: true });
        } else {
          results.push({ name: combo.name, ok: false, error: "Delete failed" });
        }
      }
      return NextResponse.json({ action, changed, results });
    }

    // ── duplicate ─────────────────────────────────────────────────────────
    if (action === "duplicate") {
      const taken = new Set(combos.map((c) => c.name));
      let changed = 0;
      for (const combo of selected) {
        const candidate = uniqueCopyName(taken, combo.name);
        if (!candidate) {
          results.push({ name: combo.name, ok: false, error: "No free copy name" });
          continue;
        }
        const verdict = validateComboName(candidate);
        if (!verdict.ok) {
          results.push({ name: combo.name, ok: false, error: verdict.error });
          continue;
        }
        const created = await createCombo({
          name: verdict.name,
          models: normalizeModels(combo.models),
          kind: combo.kind || null,
        });
        taken.add(verdict.name);
        changed += 1;
        results.push({ name: combo.name, ok: true, newName: created?.name || verdict.name });
      }
      return NextResponse.json({ action, changed, results });
    }

    // ── setStrategy ───────────────────────────────────────────────────────
    // One settings write for the whole selection (the strategy map is a single
    // object), then one rotation reset — the same posture as PATCH /api/settings.
    if (action === "setStrategy") {
      const patch = {};
      if (typeof body.strategy === "string" && body.strategy) patch.fallbackStrategy = body.strategy;
      if (typeof body.judgeModel === "string") patch.judgeModel = body.judgeModel;
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "Nothing to set — pass strategy and/or judgeModel" }, { status: 400 });
      }

      const settings = (await getSettings()) || {};
      let next = { ...(settings.comboStrategies || {}) };
      for (const combo of selected) {
        next = mergeComboStrategy(next, combo.name, patch);
        results.push({ name: combo.name, ok: true });
      }
      await updateSettings({ comboStrategies: next });
      resetComboRotation();
      return NextResponse.json({ action, changed: selected.length, results });
    }

    // ── renameNamespace ───────────────────────────────────────────────────
    // "vela/cc/opus" under prefix "vela/cc" with nextPrefix "vela/claude" →
    // "vela/claude/opus". Names outside the prefix come back untouched, and a
    // collision is refused by name rather than silently dropped.
    if (action === "renameNamespace") {
      const prefix = typeof body.prefix === "string" ? body.prefix.replace(/\/+$/, "") : "";
      const nextPrefix = typeof body.nextPrefix === "string" ? body.nextPrefix.replace(/\/+$/, "") : "";
      if (!prefix || !nextPrefix) {
        return NextResponse.json({ error: "prefix and nextPrefix are required" }, { status: 400 });
      }

      const taken = new Set(combos.map((c) => c.name));
      let changed = 0;
      for (const combo of selected) {
        const candidate = renamespaceName(combo.name, prefix, nextPrefix);
        if (candidate === combo.name) {
          results.push({ name: combo.name, ok: false, error: `Not under ${prefix}/` });
          continue;
        }
        const verdict = validateComboName(candidate);
        if (!verdict.ok) {
          results.push({ name: combo.name, ok: false, error: verdict.error });
          continue;
        }
        if (taken.has(verdict.name) && verdict.name !== combo.name) {
          results.push({ name: combo.name, ok: false, error: `"${verdict.name}" already exists` });
          continue;
        }
        const updated = await updateCombo(combo.id, { name: verdict.name });
        if (!updated) {
          results.push({ name: combo.name, ok: false, error: "Rename failed" });
          continue;
        }
        resetComboRotation(combo.name);
        (taken.delete(combo.name), taken.add(verdict.name));
        changed += 1;
        results.push({ name: combo.name, ok: true, newName: updated.name });
      }
      return NextResponse.json({ action, changed, results });
    }

    // Unreachable — ACTIONS is exhaustive above.
    return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
  } catch (error) {
    console.log("Error running bulk combo action:", error);
    return NextResponse.json({ error: "Failed to run bulk action" }, { status: 500 });
  }
}

// GET /api/combos/bulk — the action roster, so a client can render the bulk bar
// from the server's own vocabulary instead of hardcoding a second copy of it.
export async function GET() {
  const combos = (await getCombos()) || [];
  return NextResponse.json({
    actions: [
      { id: "setStrategy", label: "Set strategy", params: ["strategy", "judgeModel"] },
      { id: "duplicate", label: "Duplicate" },
      { id: "renameNamespace", label: "Rename namespace", params: ["prefix", "nextPrefix"] },
      { id: "delete", label: "Delete", destructive: true },
    ],
    counts: {
      combos: combos.length,
      llm: combos.filter(isLlmCombo).length,
    },
  });
}
