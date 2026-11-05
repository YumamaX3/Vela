// GET /api/plans/{id}/keys — how many live keys inherit this plan.
// The dashboard reads it to explain the 409 before the operator hits it.
import { NextResponse } from "next/server";
import { getPlan, countPlanKeys } from "@/lib/db/repos/plansRepo.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  if (!(await getPlan(id))) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  return NextResponse.json({ id, keys: await countPlanKeys(id) });
}
