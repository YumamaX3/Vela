// Usage Observatory W3-D — digest state, the sqlite harbor.
// The weekly digest must fire exactly ONCE per week even across server
// restarts and hot reloads, so its last-sent marker rides the kv store
// (scope "digest") — posture-bound, twin-parity, export-covered generically
// (Storage Covenant A3). Same kv-plumbing contract as W3-A's budgetRepo:
// no new table, no migration. Plan: plans/mirror-usage-observatory/SEALED-PLAN.md.

import { makeKv } from "../../helpers/kvStore.js";

const SCOPE = "digest";
const digestKv = makeKv(SCOPE);
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
