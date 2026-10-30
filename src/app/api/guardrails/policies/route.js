// GUARDRAIL POLICIES — the dashboard's door to the policy store.
//
// The store (src/lib/guardrails/policyStore.js) is the authority; these routes
// are a thin, honest shell over it. Nothing is validated here that the store
// does not already validate — a second validator is a second dialect, and the
// two drift.
//
// The request shape accepts both Vela's flat form and the 9router-go form:
//   { name, scope, target | scopeId, direction, detectors | config.detectors,
//     action | config.action, priority, enabled, notes }
// Porting a dashboard client from the Go harbor should not require rewriting
// its payloads.

import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import {
  listPolicies,
  createPolicy,
  SCOPES,
} from "@/lib/guardrails/policyStore.js";

/** Normalise the two accepted bodies into the store's flat shape. */
function normalizeBody(input = {}) {
  const out = { ...input };
  if (out.scopeId !== undefined && out.target === undefined) out.target = out.scopeId;
  delete out.scopeId;

  // 9router-go carries detectors and action inside a JSON `config` string.
  if (typeof out.config === "string") {
    try { out.config = JSON.parse(out.config); } catch { /* leave it; the store will reject nothing here */ }
  }
  if (out.config && typeof out.config === "object") {
    if (out.detectors === undefined && Array.isArray(out.config.detectors)) out.detectors = out.config.detectors;
    if (out.action === undefined && typeof out.config.action === "string") out.action = out.config.action;
  }
  delete out.config;
  return out;
}

// GET /api/guardrails/policies[?scope=&target=] — list policies
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");
    const target = searchParams.get("target") || searchParams.get("scopeId");

    let policies = await listPolicies();
    if (scope) {
      if (!SCOPES.includes(scope)) {
        return NextResponse.json({ error: `unknown scope: ${scope}` }, { status: 400 });
      }
      policies = policies.filter((p) => p.scope === scope);
    }
    if (target) policies = policies.filter((p) => p.target === target);

    return NextResponse.json(policies);
  } catch (error) {
    log.error("API", "Failed to list policies:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to list guardrail policies" }, { status: 500 });
  }
}

// POST /api/guardrails/policies — create a policy
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    const result = await createPolicy(normalizeBody(body));
    if (!result.ok) {
      return NextResponse.json({ error: result.errors.join("; "), errors: result.errors }, { status: 400 });
    }
    return NextResponse.json(result.policy, { status: 201 });
  } catch (error) {
    log.error("API", "Failed to create policy:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to create guardrail policy" }, { status: 500 });
  }
}
