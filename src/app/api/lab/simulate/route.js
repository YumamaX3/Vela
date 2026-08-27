import { NextResponse } from "next/server";
import { buildFallbackChain } from "open-sse/services/fallbackRuleMatcher.js";
import { getFallbackRules } from "@/lib/db/repos/fallbackRulesRepo.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// AI Lab simulator (criterion-1) — fabricate a refusal event, run the REAL
// buildFallbackChain against the operator's actual rules, and render the
// chain to the serving lane. Session-auth'd by the dashboard middleware.
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const status = Number(body?.status) || 403;
    const errorText = typeof body?.errorText === "string" ? body.errorText : "";
    const model = typeof body?.model === "string" ? body.model : "gpt-5";

    const rules = await getFallbackRules();
    const event = { status, errorText };
    const chain = buildFallbackChain(rules || [], event);

    return NextResponse.json({
      model,
      status,
      errorText,
      verdict: "GATEWAY_POLICY_BLOCK",
      chain,
      note: chain.length ? `refused workload rides → ${chain[0]}` : "no matching rules for this event",
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "simulate failed" }, { status: 400 });
  }
}
