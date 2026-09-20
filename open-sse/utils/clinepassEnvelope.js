/**
 * Cline / ClinePass non-stream response envelope unwrap.
 *
 * The Cline upstream (api.cline.bot) wraps non-streaming JSON responses in a
 * `{success, data}` envelope (errors use `{success: false, error}`). Consumers
 * reading `choices`/`usage` at the top level then see none and report
 * "Provider returned no completion choices for this model" (upstream #3644).
 *
 * This module detects the envelope, unwraps the inner `data` object, and
 * surfaces the error envelope as `{message, status}` so the caller can return a
 * clean upstream error instead of a body with no `choices`. Non-enveloped
 * bodies pass through untouched.
 *
 * Scoped to providers opting in via `transport.quirks.clineEnvelope` (merged to
 * `PROVIDERS[provider].quirks` by the registry schema) so no other provider's
 * response body is ever rewritten.
 *
 * Ported from VansRouter (W4 · sibling-harbor-ports §3.1 row 7). Vela has no
 * dedicated clinepass executor — clinepass dispatches through `default.js` —
 * so the executor wires this on that path.
 */
import { PROVIDERS } from "../providers/index.js";

/**
 * @param {object} body - Parsed upstream response body
 * @param {string} provider - Provider id or alias
 * @returns {{body: object|null, error: {message: string, status: number|null}|null}}
 *   `{body: <unwrapped or original>, error: null}` when no error envelope is
 *   present; `{body: null, error: {...}}` when `success === false`.
 */
export function unwrapClinepassEnvelope(body, provider) {
  if (!PROVIDERS[provider]?.quirks?.clineEnvelope) return { body, error: null };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { body, error: null };
  if (!("success" in body)) return { body, error: null };

  if (body.success === false) {
    const message = typeof body.error === "string"
      ? body.error
      : body.error?.message || body.message || "Upstream error";
    return { body: null, error: { message, status: body.statusCode || null } };
  }

  if (body.success === true && "data" in body && body.data !== null && typeof body.data === "object" && !Array.isArray(body.data)) {
    return { body: body.data, error: null };
  }

  return { body, error: null };
}
