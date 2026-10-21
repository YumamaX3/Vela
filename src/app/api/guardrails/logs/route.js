// GUARDRAIL AUDIT LOGS — what matched, never what it was.
//
// A row names the detector, the entity class, the action and when. It never
// stores the matched value: this table is evidence that a rule fired, not a
// second copy of the secret it protected. `excerpt` carries surrounding text
// with every finding already replaced by [REDACTED].
//
// Query:  GET /api/guardrails/logs?limit=100&action=block&entity=credit_card&sinceMs=...
// Clear:  DELETE /api/guardrails/logs?beforeMs=...   (omit beforeMs to clear all)

import { NextResponse } from "next/server";
import { listLogs, clearLogs } from "@/lib/guardrails/policyStore.js";

const MAX_LIMIT = 500;

// GET /api/guardrails/logs
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    let limit = 100;
    if (rawLimit !== null) {
      const n = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
      }
      limit = Math.min(n, MAX_LIMIT);
    }

    const sinceMs = searchParams.get("sinceMs");
    if (sinceMs !== null && !Number.isFinite(Number(sinceMs))) {
      return NextResponse.json({ error: "sinceMs must be epoch milliseconds" }, { status: 400 });
    }

    const logs = await listLogs({
      limit,
      action: searchParams.get("action") || undefined,
      entity: searchParams.get("entity") || undefined,
      sinceMs: sinceMs === null ? undefined : Number(sinceMs),
    });
    return NextResponse.json(logs);
  } catch (error) {
    console.error("[Guardrails] Failed to list logs:", error);
    return NextResponse.json({ error: "Failed to list guardrail logs" }, { status: 500 });
  }
}

// DELETE /api/guardrails/logs[?beforeMs=] — clear the audit trail
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const beforeMs = searchParams.get("beforeMs");
    if (beforeMs !== null && !Number.isFinite(Number(beforeMs))) {
      return NextResponse.json({ error: "beforeMs must be epoch milliseconds" }, { status: 400 });
    }
    const removed = await clearLogs({ beforeMs: beforeMs === null ? undefined : Number(beforeMs) });
    return NextResponse.json({ status: "ok", removed });
  } catch (error) {
    console.error("[Guardrails] Failed to clear logs:", error);
    return NextResponse.json({ error: "Failed to clear guardrail logs" }, { status: 500 });
  }
}
