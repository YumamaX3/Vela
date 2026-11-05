import { error as vlogError } from "@/sse/utils/logger.js";
// GET    /api/plans/{id} — one template
// PUT    /api/plans/{id} — partial merge (omitted fields keep their stored value)
// DELETE /api/plans/{id} — refused with 409 while any live key inherits it
import { NextResponse } from "next/server";
import { getPlan, updatePlan, deletePlan, countPlanKeys, listPlans } from "@/lib/db/repos/plansRepo.js";
import { validatePlan } from "@/lib/plans.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const plan = await getPlan(id);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  return NextResponse.json(plan);
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getPlan(id);
    if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const result = validatePlan(body, existing);
    if (!result.ok) return NextResponse.json({ error: result.errors.join("; "), errors: result.errors }, { status: 400 });

    const duplicate = (await listPlans()).some(
      (p) => p.id !== id && p.name.toLowerCase() === result.plan.name.toLowerCase()
    );
    if (duplicate) return NextResponse.json({ error: "A plan with that name already exists" }, { status: 409 });

    return NextResponse.json(await updatePlan(id, result.plan));
  } catch (error) {
    vlogError("PLANS", "update failed:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const existing = await getPlan(id);
    if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const keys = await countPlanKeys(id);
    if (keys > 0) {
      return NextResponse.json(
        { error: `Plan is inherited by ${keys} key${keys === 1 ? "" : "s"}; reassign them before deleting`, keys },
        { status: 409 }
      );
    }
    await deletePlan(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    vlogError("PLANS", "delete failed:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 });
  }
}
