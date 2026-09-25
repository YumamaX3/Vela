// POST /api/backup/prune — retention pruning, triggered by hand.
//
// pruneBackupArtifacts keeps the newest artifact per day (retainDaily days)
// plus the newest per ISO-week (retainWeekly weeks) and removes the rest. The
// scheduler already runs it after every scheduled backup; this route is the
// operator's own hand on the same lever. Under /api/backup/* it inherits
// ALWAYS_PROTECTED; as a mutation it re-confirms the dashboard password
// inside lockout accounting.
//
// Body: { password, retainDaily?, retainWeekly?, dryRun? }. A dry run answers
// WHICH artifacts would be removed and writes nothing — the operator sees the
// loss before it happens. An absent tier falls back to the env defaults.
import { NextResponse } from "next/server";
import { pruneBackupArtifacts, planPruneArtifacts } from "@/lib/db/repos/backupRepo";
import { verifyBackupPassword } from "../_lib/auth";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const denied = await verifyBackupPassword(request, body.password);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    const retainDaily = Number(body.retainDaily) > 0 ? Number(body.retainDaily) : 7;
    const retainWeekly = Number(body.retainWeekly) > 0 ? Number(body.retainWeekly) : 4;

    // The dry run reads the SAME planner the real prune executes — one home
    // for the retention law, so a plan and its cut cannot disagree.
    if (body.dryRun === true) {
      const plan = planPruneArtifacts({ retainDaily, retainWeekly });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        retainDaily,
        retainWeekly,
        kept: plan.kept,
        remove: plan.removeNames,
        message: plan.removeNames.length
          ? `${plan.removeNames.length} artifact(s) would be pruned`
          : "Nothing to prune — every artifact is inside the retention window",
      });
    }

    const result = pruneBackupArtifacts({ retainDaily, retainWeekly });
    return NextResponse.json({
      ok: true,
      dryRun: false,
      retainDaily,
      retainWeekly,
      kept: result.kept,
      removed: result.removed,
      message: result.removed.length
        ? `Pruned ${result.removed.length} artifact(s), kept ${result.kept}`
        : "Nothing to prune — every artifact is inside the retention window",
    });
  } catch (err) {
    const msg = err?.message || "";
    const safe = msg.startsWith("[backup] VELA_BACKUP_ENCRYPTION_KEY") ? msg : "Prune failed";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
