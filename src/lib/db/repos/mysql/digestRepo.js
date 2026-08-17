// Usage Observatory W3-D — digest state, the mysql twin harbor.
// Same contract as sqlite/digestRepo.js; only the kv plumbing changes harbor
// (makeKvMysql + backticked `key`), byte-for-byte otherwise. The weekly
// digest's last-sent marker rides the kv store (scope "digest") — posture-bound,
// twin-parity, export-covered generically (Storage Covenant A3).
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md.

import { makeKvMysql } from "../../mysql/kv.js";

const SCOPE = "digest";
const digestKv = makeKvMysql(SCOPE);
const STATE_KEY = "state";

/** The persisted digest marker: { lastSentWeek, lastSentAt } or {}. */
export async function getDigestState() {
  const state = await digestKv.get(STATE_KEY, {});
  return state && typeof state === "object" ? state : {};
}

/** Persist the digest marker. Overwrites the prior one. */
export async function setDigestState(state) {
  await digestKv.set(STATE_KEY, state && typeof state === "object" ? state : {});
}
