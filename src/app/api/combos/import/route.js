import { NextResponse } from "next/server";
import {
  getCombos,
  getSettings,
  createCombo,
  updateCombo,
  updateSettings,
} from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import { validateComboName } from "@/shared/constants/comboValidation";
import {
  mergeComboStrategy,
  normalizeModels,
  parseComboKind,
  readJsonBody,
  uniqueCopyName,
} from "../_lib/combosApi.js";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 500;
const CONFLICT_MODES = ["skip", "overwrite", "rename"];

// POST /api/combos/import
// Body: { payload | combos, strategies?, mode: "dry-run" | "apply",
//         onConflict?: "skip" | "overwrite" | "rename", applyStrategies?: boolean }
//
// The dry run is the point of this route. The old client-side import looped
// POST /api/combos and counted what stuck, so a mistyped file half-landed before
// anyone could see what it contained. Here the whole file is judged first —
// invalid names, conflicts, and the exact names that would land — and only an
// explicit "apply" writes anything.
export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const raw = body.payload ?? body;
    const incoming = Array.isArray(raw) ? raw : raw?.combos;
    if (!Array.isArray(incoming)) {
      return NextResponse.json({ error: "That payload carries no combos array" }, { status: 400 });
    }
    if (incoming.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Too many combos in one import (max ${MAX_ITEMS})` }, { status: 400 });
    }

    const mode = body.mode === "apply" ? "apply" : "dry-run";
    const onConflict = CONFLICT_MODES.includes(body.onConflict) ? body.onConflict : "skip";
    const incomingStrategies = (raw?.strategies && typeof raw.strategies === "object") ? raw.strategies : (body.strategies || {});
    const applyStrategies = body.applyStrategies !== false;

    const combos = (await getCombos()) || [];
    const byName = new Map(combos.map((c) => [c.name, c]));
    const taken = new Set(combos.map((c) => c.name));

    const plan = [];
    const invalid = [];
    for (const item of incoming) {
      const verdict = validateComboName(item?.name);
      if (!verdict.ok) {
        invalid.push({ name: typeof item?.name === "string" ? item.name : "(unnamed)", error: verdict.error });
        continue;
      }
      const kindVerdict = parseComboKind(item?.kind);
      if (!kindVerdict.ok) {
        invalid.push({ name: verdict.name, error: kindVerdict.error });
        continue;
      }

      const existing = byName.get(verdict.name);
      if (!existing) {
        plan.push({ action: "add", name: verdict.name, models: normalizeModels(item?.models), kind: kindVerdict.kind });
        continue;
      }
      if (onConflict === "skip") {
        plan.push({ action: "skip", name: verdict.name, reason: "already exists" });
      } else if (onConflict === "overwrite") {
        plan.push({ action: "overwrite", id: existing.id, name: verdict.name, models: normalizeModels(item?.models), kind: kindVerdict.kind });
      } else {
        const candidate = uniqueCopyName(taken, verdict.name);
        if (!candidate) {
          plan.push({ action: "skip", name: verdict.name, reason: "no free copy name" });
          continue;
        }
        taken.add(candidate);
        plan.push({ action: "add", name: candidate, from: verdict.name, models: normalizeModels(item?.models), kind: kindVerdict.kind });
      }
    }

    const summary = {
      incoming: incoming.length,
      add: plan.filter((p) => p.action === "add").length,
      overwrite: plan.filter((p) => p.action === "overwrite").length,
      skip: plan.filter((p) => p.action === "skip").length,
      invalid: invalid.length,
    };

    if (mode === "dry-run") {
      return NextResponse.json({ mode, onConflict, summary, invalid, plan, applied: null });
    }

    const results = [];
    let changed = 0;
    const landedNames = [];

    for (const step of plan) {
      if (step.action === "skip") {
        results.push({ name: step.name, ok: false, error: step.reason });
        continue;
      }
      if (step.action === "overwrite") {
        const updated = await updateCombo(step.id, { models: step.models, kind: step.kind });
        if (updated) {
          resetComboRotation(step.name);
          changed += 1;
          landedNames.push(step.name);
          results.push({ name: step.name, ok: true, action: "overwrite" });
        } else {
          results.push({ name: step.name, ok: false, error: "Update failed" });
        }
        continue;
      }
      const created = await createCombo({ name: step.name, models: step.models, kind: step.kind });
      if (created) {
        changed += 1;
        landedNames.push(step.name);
        results.push({ name: step.name, ok: true, action: "add" });
      } else {
        results.push({ name: step.name, ok: false, error: "Create failed" });
      }
    }

    // Strategies ride along only for names that actually landed — a strategy
    // pointing at a combo that was skipped would be a setting about nothing.
    let strategiesApplied = 0;
    if (applyStrategies && landedNames.length) {
      const settings = (await getSettings()) || {};
      let next = { ...(settings.comboStrategies || {}) };
      const landed = new Set(landedNames);
      for (const [name, strategy] of Object.entries(incomingStrategies)) {
        const target = landed.has(name) ? name : null;
        if (!target) continue;
        next = mergeComboStrategy(next, target, strategy || {});
        strategiesApplied += 1;
      }
      if (strategiesApplied > 0) {
        await updateSettings({ comboStrategies: next });
        resetComboRotation();
      }
    }

    return NextResponse.json({
      mode,
      onConflict,
      summary,
      invalid,
      plan,
      applied: { changed, strategies: strategiesApplied, results },
    });
  } catch (error) {
    console.log("Error importing combos:", error);
    return NextResponse.json({ error: "Failed to import combos" }, { status: 500 });
  }
}
