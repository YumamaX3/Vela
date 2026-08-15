/**
 * Freebuff session-affinity resolver — pins same-model chat traffic to the
 * connection already holding that model's warm session, so requests ride the
 * claimed session instead of re-claiming (a claim burns one of ~6 daily units).
 *
 * Registered once at import; the resolver is fail-open (returns null when no
 * warm session matches), so selection falls through to the configured strategy.
 */
import { registerConnectionResolver } from "./connectionPreference.js";
import { findWarmConnection } from "open-sse/services/freebuffSession.js";

registerConnectionResolver("freebuff", async ({ model }) => {
  if (!model) return null;
  return findWarmConnection(model);
});
