import { PROVIDERS } from "../providers/index.js";
/**
 * Unwrap Cline's non-stream envelope: {"success":true,"data":{...choices...}}.
 *
 * Cline (api.cline.bot) wraps non-stream chat completions in that envelope;
 * consumers reading choices/usage at top level then see none and report
 * "Provider returned no completion choices for this model" (upstream #3644).
 *
 * Scoped to providers opting in via transport.quirks.clineEnvelope (merged to
 * PROVIDERS[provider].quirks — the same hoist M0's Claude-tool gate relies on,
 * probed live) so no other provider's response body is ever rewritten. The
 * error envelope ({"success":false,...}) never matches and passes through
 * untouched.
 *
 * (ported from upstream 9router 122f23ee — ADR-004 M2; the catalog/airforce
 * legs of that commit are declined for Vela, see the registers)
 *
 * @param {object} body - Parsed upstream response body
 * @param {string} provider - Provider id or alias
 * @returns {object} The inner `data` object, or `body` unchanged
 */
export function unwrapClineEnvelope(body, provider) {
  if (!provider || !PROVIDERS[provider]?.quirks?.clineEnvelope) return body;
  const { success, data } = body || {};
  if (success !== true || !data || typeof data !== "object" || Array.isArray(data)) return body;
  return data;
}
