"use client";
// HealthVerdict — the three-state probe badge, the console's answer to Defect 2.
//
// The wound: a health path that had only two states reported an INDETERMINATE probe
// (timeout, 5xx, rate-limited probe target, a throw in the probe's own path) as
// `dead`. An operator reading "dead" would disable a pool that was merely unknown —
// and the fleet once self-liquidated this way. So this badge renders three states
// and names the third one: `ok`, `dead`, and `indeterminate`.
//
// R-22: the dot is SEMANTIC — it reports a measured verdict and the label is beside
// it, so the colour is never the only carrier of meaning. The indeterminate state is
// amber, never red: red says "this pool is dead", and the whole point is that we do
// not know that.
import { Badge } from "@/shared/components";
import { VERDICT, VERDICT_META, verdictFromTestStatus, verdictFromResult } from "../lib/proxyFormat";

export function VerdictBadge({ verdict, size = "sm" }) {
  const meta = VERDICT_META[verdict] || VERDICT_META[VERDICT.INDETERMINATE];
  return (
    <Badge variant={meta.variant} size={size} dot title={meta.title}>
      {meta.label}
    </Badge>
  );
}

/** A pool's verdict from its persisted `testStatus`. */
export function PoolVerdictBadge({ pool, size = "sm" }) {
  return <VerdictBadge verdict={verdictFromTestStatus(pool?.testStatus)} size={size} />;
}

/** A verdict from a fresh probe result (single or a bulk `results[]` entry). */
export function ResultVerdictBadge({ result, size = "sm" }) {
  return <VerdictBadge verdict={verdictFromResult(result)} size={size} />;
}

export default PoolVerdictBadge;
