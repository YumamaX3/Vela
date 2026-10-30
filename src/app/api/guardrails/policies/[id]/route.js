// GUARDRAIL POLICY — one policy, read / rewritten / removed.
//
// PUT and PATCH are the same operation here because the store merges a patch
// over the existing row and validates the merge: there is no "replace the
// whole document" semantics to lose. A missing id is 404, never a silent
// create — that is the difference between an edit and a duplicate.

import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { getPolicy, updatePolicy, deletePolicy } from "@/lib/guardrails/policyStore.js";

function normalizeBody(input = {}) {
  const out = { ...input };
  if (out.scopeId !== undefined && out.target === undefined) out.target = out.scopeId;
  delete out.scopeId;
  delete out.id;

  if (typeof out.config === "string") {
    try { out.config = JSON.parse(out.config); } catch { /* store validation owns it */ }
  }
  if (out.config && typeof out.config === "object") {
    if (out.detectors === undefined && Array.isArray(out.config.detectors)) out.detectors = out.config.detectors;
    if (out.action === undefined && typeof out.config.action === "string") out.action = out.config.action;
  }
  delete out.config;
  return out;
}

// GET /api/guardrails/policies/[id]
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const policy = await getPolicy(id);
    if (!policy) return NextResponse.json({ error: "guardrail policy not found" }, { status: 404 });
    return NextResponse.json(policy);
  } catch (error) {
    log.error("API", "Failed to fetch policy:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to fetch guardrail policy" }, { status: 500 });
  }
}

async function update(request, params) {
  try {
    const { id } = await params;
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    const result = await updatePolicy(id, normalizeBody(body));
    if (result.notFound) {
      return NextResponse.json({ error: "guardrail policy not found" }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json({ error: result.errors.join("; "), errors: result.errors }, { status: 400 });
    }
    return NextResponse.json(result.policy);
  } catch (error) {
    log.error("API", "Failed to update policy:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to update guardrail policy" }, { status: 500 });
  }
}

// PUT /api/guardrails/policies/[id]
export async function PUT(request, { params }) {
  return update(request, params);
}

// PATCH /api/guardrails/policies/[id]
export async function PATCH(request, { params }) {
  return update(request, params);
}

// DELETE /api/guardrails/policies/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const result = await deletePolicy(id);
    if (result.notFound) {
      return NextResponse.json({ error: "guardrail policy not found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok", id });
  } catch (error) {
    log.error("API", "Failed to delete policy:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to delete guardrail policy" }, { status: 500 });
  }
}
