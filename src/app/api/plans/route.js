import { error as vlogError } from "@/sse/utils/logger.js";
// GET /api/plans — every template, oldest first.
// POST /api/plans — create a template (id generated here, never client-chosen).
import { NextResponse } from "next/server";
import { listPlans, createPlan } from "@/lib/db/repos/plansRepo.js";
import { validatePlan } from "@/lib/plans.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ plans: await listPlans() });
  } catch (error) {
    vlogError("PLANS", "list failed:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to list plans" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = validatePlan(body, {});
    if (!result.ok) return NextResponse.json({ error: result.errors.join("; "), errors: result.errors }, { status: 400 });
    if (await listPlans().then((plans) => plans.some((p) => p.name.toLowerCase() === result.plan.name.toLowerCase()))) {
      return NextResponse.json({ error: "A plan with that name already exists" }, { status: 409 });
    }
    return NextResponse.json(await createPlan(result.plan), { status: 201 });
  } catch (error) {
    vlogError("PLANS", "create failed:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to create plan" }, { status: 500 });
  }
}
