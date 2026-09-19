import { NextResponse } from "next/server";
import { getCombos, getSettings } from "@/lib/localDb";
import { getComboUsage } from "@/lib/usageDb";
import {
  isLlmCombo,
  loadMemberHub,
  providerOf,
  reachabilityOf,
  strategyOf,
} from "../_lib/combosApi.js";

export const dynamic = "force-dynamic";

// GET /api/combos/stats?hours=24&top=5
// The fleet census: counts, strategy mix, harbors, and the two lists the
// operator actually scans — top combos by traffic, and everything that needs
// attention (unreachable members, empty member lists, a weak ok-ratio).
// Computed server-side so the page, the API and any future client agree on one
// arithmetic; the page keeps its own client-side fallback for the first paint.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Math.min(720, Math.max(1, Number(searchParams.get("hours")) || 24));
    const topN = Math.min(20, Math.max(1, Number(searchParams.get("top")) || 5));

    const [combos, settings, hub, usage] = await Promise.all([
      getCombos(),
      getSettings(),
      loadMemberHub(),
      getComboUsage({ hours, buckets: 24 }),
    ]);

    const llm = (combos || []).filter(isLlmCombo);
    const comboStrategies = settings?.comboStrategies || {};
    const usageByName = new Map((usage?.combos || []).map((u) => [u.combo, u]));

    const byStrategy = { fallback: 0, "round-robin": 0, fusion: 0 };
    const harbors = new Map();
    const uniqueModels = new Set();
    const providers = new Set();
    const rows = [];

    let members = 0;
    let unreachableMembers = 0;
    let emptyCombos = 0;

    for (const combo of llm) {
      const models = Array.isArray(combo.models) ? combo.models : [];
      members += models.length;
      if (models.length === 0) emptyCombos += 1;
      for (const model of models) {
        uniqueModels.add(model);
        const provider = providerOf(model);
        if (provider) providers.add(provider);
      }

      const reach = reachabilityOf(models, hub);
      unreachableMembers += reach.total - reach.reachable;

      const strategy = strategyOf(comboStrategies, combo.name);
      byStrategy[strategy] = (byStrategy[strategy] || 0) + 1;

      const slash = combo.name.lastIndexOf("/");
      const harbor = slash === -1 ? "" : combo.name.slice(0, slash);
      if (!harbors.has(harbor)) harbors.set(harbor, { harbor, combos: 0, members: 0 });
      const bucket = harbors.get(harbor);
      bucket.combos += 1;
      bucket.members += models.length;

      const u = usageByName.get(combo.name) || null;
      const requests = u?.requests || 0;
      const tokens = (u?.promptTokens || 0) + (u?.completionTokens || 0);
      rows.push({
        name: combo.name,
        kind: combo.kind || "llm",
        strategy,
        members: models.length,
        reachable: reach.reachable,
        judged: reach.total,
        requests,
        tokens,
        cost: u?.cost || 0,
        okRatio: requests > 0 ? (u.ok || 0) / requests : null,
        lastAt: u?.lastAt || null,
      });
    }

    const active = rows.filter((r) => r.requests > 0);
    const idle = rows.filter((r) => r.requests === 0).map((r) => r.name);

    const attention = rows
      .map((r) => {
        const reasons = [];
        if (r.members === 0) reasons.push("no members");
        if (r.judged > 0 && r.reachable < r.judged) {
          reasons.push(`${r.judged - r.reachable} member provider${r.judged - r.reachable === 1 ? "" : "s"} offline`);
        }
        if (r.okRatio !== null && r.requests >= 5 && r.okRatio < 0.9) {
          reasons.push(`${Math.round(r.okRatio * 100)}% ok`);
        }
        return { name: r.name, reasons };
      })
      .filter((r) => r.reasons.length > 0);

    const topCombos = [...active]
      .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens)
      .slice(0, topN)
      .map(({ name, requests, tokens, cost, okRatio, lastAt, strategy }) => ({
        name,
        requests,
        tokens,
        cost,
        okRatio,
        lastAt,
        strategy,
      }));

    return NextResponse.json({
      window: { hours, buckets: usage?.buckets || 24, since: usage?.since || null },
      totals: {
        combos: llm.length,
        // Combos of every kind are in the table; only llm ones are analysed.
        combosAllKinds: (combos || []).length,
        members,
        uniqueModels: uniqueModels.size,
        providers: providers.size,
        unreachableMembers,
        emptyCombos,
        fusionCombos: byStrategy.fusion || 0,
        activeCombos: active.length,
        idleCombos: idle.length,
      },
      byStrategy,
      harbors: [...harbors.values()].sort((a, b) => a.harbor.localeCompare(b.harbor)),
      top: topCombos,
      attention,
      idle: idle.slice(0, 50),
    });
  } catch (error) {
    console.log("Error computing combo stats:", error);
    return NextResponse.json({ error: "Failed to compute combo stats" }, { status: 500 });
  }
}
