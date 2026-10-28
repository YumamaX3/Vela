// CodeBuddy channel verification — the refusal that looks like a request fault.
//
// The gateway rejects a request whose client identity it does not recognise with
// business code `11128` (sometimes serialized as `11-128`) and wording such as
// "channel verification", "official client", or "illegal api invocation from an
// unapproved channel". It arrives as HTTP 400, so the generic classifier reads it
// as request-scoped: the account is never cooled down, the combo advances without
// learning anything, and the same rejection repeats on every later request.
//
// Two laws are carried here, both from the reference gateway (codebuddy2api,
// app/upstream_compat.py):
//
//   1. RECOGNITION REQUIRES BOTH HALVES. A bare `code: 11128` or a bare channel
//      phrase is not enough — the code alone appears in unrelated payloads, and
//      the phrase alone appears in documentation and echo. Only when the business
//      code AND its explanatory text agree is this a channel rejection.
//
//   2. THE CONSOLE DOOR, ONCE. The primary `v2/chat/completions` door fronts a
//      client-identity check; the `console/chat/completions` door does not carry
//      the same check. A confirmed rejection on the primary door earns exactly one
//      retry against the console door — never more, and never for any other path.

/**
 * Does this payload carry the channel-verification business code?
 *
 * The code may arrive inside a JSON string that is itself embedded in JSON, so it
 * can appear with escaped quotes (`\"code\":\"11128\"`) and escaped backslashes.
 * The pattern tolerates both rather than requiring a clean object, and guards the
 * tail so `111280` cannot match by accident.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasChannelCode(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  return /(['"])code\\*\1\s*:\s*\\*(['"]?)(?:11128|11-128)\\*\2(?!\d)/i.test(text);
}

const CHANNEL_MARKERS = [
  "channel verification",
  "official client",
  "illegal api invocation from an unapproved channel",
];
const CHANNEL_MARKER_ZH = "渠道校验";

/**
 * Is this a confirmed channel rejection? Both halves must agree.
 *
 * @param {string|Uint8Array} raw - The upstream body, as bytes or text.
 * @returns {boolean}
 */
export function isChannelCheckError(raw) {
  const text = typeof raw === "string"
    ? raw
    : (raw ? new TextDecoder().decode(raw) : "");
  if (!text) return false;
  if (!hasChannelCode(text)) return false;
  if (text.includes(CHANNEL_MARKER_ZH)) return true;
  const lower = text.toLowerCase();
  return CHANNEL_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * The console door for a primary chat URL, or null when this URL has none.
 *
 * Only `/v2/chat/completions` has a console twin. Any other path — an already
 * rewritten one, a proxy path, a different product — returns null, so the caller
 * can never bounce a request somewhere the rule did not intend.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function channelFallbackUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.pathname !== "/v2/chat/completions") return null;
  parsed.pathname = "/console/chat/completions";
  return parsed.toString();
}

/**
 * Should this refusal be retried against the console door?
 *
 * Exactly one condition set: a real fallback URL exists, the status is 400, and
 * the body is a confirmed channel rejection. Everything else is left to the
 * ordinary classifier.
 *
 * @param {string|null} fallbackUrl
 * @param {number} status
 * @param {string|Uint8Array} raw
 * @returns {boolean}
 */
export function shouldChannelFallback(fallbackUrl, status, raw) {
  return Boolean(fallbackUrl) && status === 400 && isChannelCheckError(raw);
}
