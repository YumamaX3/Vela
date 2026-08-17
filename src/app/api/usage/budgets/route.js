// Usage Observatory W3-A — /api/usage/budgets — the budget-definition surface.
//
// Protection: the dashboardGuard middleware covers the whole "/api/usage"
// prefix (PROTECTED_API_PATHS) — posture-consistent with every other usage
// config surface (phase13 Gate-11 decision: config rides the same posture as
// the reads; only the unbounded export stream escalates).
//
// Addressing: budget ids carry ":" and (for model scope) "/" — e.g.
// "model:openai/gpt-4o". Path-segment routes would meet the encoded-slash
// trap, so single-entity operations address by ?id= (query params decode
// cleanly). All bodies are JSON; validation rides budgetDef.js — every 400
// repeats the honest error list verbatim.
//
//   GET    /api/usage/budgets           — list all definitions (active first)
//   GET    /api/usage/budgets?id=<id>   — one definition or 404
//   POST   /api/usage/budgets           — create (400 on invalid input,
//                                         409 when MAX_BUDGETS bites)
//   PATCH  /api/usage/budgets?id=<id>   — partial update (may change id;
//                                         404 if absent, 400 on invalid)
//   DELETE /api/usage/budgets?id=<id>   — remove (404 if absent)
import { NextResponse } from "next/server";
import {
  listBudgets, getBudget, upsertBudget, updateBudget, removeBudget,
} from "@/lib/db/repos/budgetRepo.js";
import { BudgetValidationError } from "@/lib/budgetDef.js";

export const dynamic = "force-dynamic";

function errorResponse(status, message, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (id) {
    const def = await getBudget(id);
    if (!def) return errorResponse(404, "budget not found");
    return NextResponse.json({ budget: def });
  }
  return NextResponse.json({ budgets: await listBudgets() });
}

export async function POST(request) {
  const body = await parseBody(request);
  if (!body || typeof body !== "object") {
    return errorResponse(400, "request body must be a JSON budget definition");
  }
  try {
    const def = await upsertBudget(body);
    return NextResponse.json({ budget: def }, { status: 201 });
  } catch (error) {
    if (error instanceof BudgetValidationError) {
      const limitReached = error.errors.some((e) => e.startsWith("budget limit reached"));
      return errorResponse(limitReached ? 409 : 400, error.message, { errors: error.errors });
    }
    console.error("[budgets] create failed:", error);
    return errorResponse(500, "failed to create budget");
  }
}

export async function PATCH(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return errorResponse(400, "PATCH requires ?id=<budget id>");
  const body = await parseBody(request);
  if (!body || typeof body !== "object") {
    return errorResponse(400, "request body must be a JSON partial budget definition");
  }
  try {
    const def = await updateBudget(id, body);
    if (!def) return errorResponse(404, "budget not found");
    return NextResponse.json({ budget: def });
  } catch (error) {
    if (error instanceof BudgetValidationError) {
      const limitReached = error.errors.some((e) => e.startsWith("budget limit reached"));
      return errorResponse(limitReached ? 409 : 400, error.message, { errors: error.errors });
    }
    console.error("[budgets] update failed:", error);
    return errorResponse(500, "failed to update budget");
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return errorResponse(400, "DELETE requires ?id=<budget id>");
  const removed = await removeBudget(id);
  if (!removed) return errorResponse(404, "budget not found");
  return NextResponse.json({ removed: true });
}
