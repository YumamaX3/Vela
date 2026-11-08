// CodeBuddy channel verification and origin fallback — the refusals that look like
// request faults, and the second door that rescues them.
//
// The gateway rejects a request whose client identity it does not recognise with
// business code `11128` (sometimes serialized as `11-128`) and wording such as
// "channel verification", "official client", or "illegal api invocation from an
// unapproved channel". It arrives as HTTP 400, so the generic classifier reads it
// as request-scoped: the account is never cooled down, the combo advances without
// learning anything, and the same rejection repeats on every later request.
//
// Three laws are carried here, all from the reference gateway (codebuddy2api v1.5.4,
// app/upstream_compat.py):
//
//   1. RECOGNITION REQUIRES BOTH HALVES. A bare `code: 11128` or a bare channel
//      phrase is not enough — the code alone appears in unrelated payloads, and
//      the phrase alone appears in documentation and echo. Only when the business
//      code AND its explanatory text agree is this a channel rejection.
//
//   2. THE CONSOLE DOOR IS INTERNATIONAL-ONLY. channel_fallback_url (upstream
//      lines 193-204) returns the `console/chat/completions` twin ONLY when the
//      primary URL's host names an intl profile; every CN host gets null. A CN
//      request never earns a console retry — its escape is the backup ORIGIN below.
//
//   3. THE WORKBUDDY BACKUP ORIGIN, ONCE. workbuddy_origin_fallback_url (lines
//      207-218) maps a domestic WorkBuddy chat URL onto `wb.tencentbuddy.com`, and
//      should_origin_fallback (lines 221-223) replays it only on the transient
//      gateway statuses 408/502/503/504 — never on a business refusal. A replay that
//      would re-spend a call the upstream already answered is not a rescue.

/** Hosts that answer for an INTL profile — the only ones with a console door. */
const INTL_CHAT_HOSTS = new Set(["www.codebuddy.ai", "www.workbuddy.ai"]);

import { isFilterError } from "./contentFilter.js";

/** The domestic WorkBuddy hosts whose chat can ride the backup origin — upstream:217. */
const WORKBUDDY_CN_CHAT_HOSTS = new Set(["www.workbuddy.cn", "copilot.tencent.com"]);

/** The official backup origin for domestic WorkBuddy chat — upstream_compat.py:19. */
export const WORKBUDDY_CN_BACKUP_ORIGIN = "wb.tencentbuddy.com";

/** The transient gateway statuses a backup-origin replay may chase — upstream:223. */
const ORIGIN_FALLBACK_STATUSES = new Set([408, 502, 503, 504]);

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
 * The console door for a primary intl chat URL, or null when this URL has none.
 *
 * Only `/v2/chat/completions` on an INTL host has a console twin (upstream
 * channel_fallback_url, lines 193-204). A CN host — copilot.tencent.com,
 * www.workbuddy.cn — returns null: the console door is not that lane's escape. Any
 * other path (already rewritten, proxy, different product) returns null too, so the
 * caller can never bounce a request somewhere the rule did not intend.
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
  if (!INTL_CHAT_HOSTS.has(parsed.hostname)) return null;
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

/**
 * The backup origin for a domestic WorkBuddy chat URL, or null when this URL has
 * none — upstream workbuddy_origin_fallback_url, lines 207-218. Only `cn-work`, only
 * the verified chat path, only on the two domestic hosts.
 *
 * @param {string} url
 * @param {string} profile - one of cn-cli | cn-work | intl-cli | intl-work
 * @returns {string|null}
 */
export function workbuddyOriginFallbackUrl(url, profile) {
  if (profile !== "cn-work") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.pathname !== "/v2/chat/completions") return null;
  if (!WORKBUDDY_CN_CHAT_HOSTS.has(parsed.hostname)) return null;
  parsed.hostname = WORKBUDDY_CN_BACKUP_ORIGIN;
  return parsed.toString();
}

/**
 * Replay only official transient gateway statuses on the backup origin — upstream
 * should_origin_fallback, lines 221-223. A business refusal (200-with-code, 4xx) is
 * never an origin problem, so it is never replayed.
 *
 * @param {string|null} fallbackUrl
 * @param {number} status
 * @returns {boolean}
 */
export function shouldOriginFallback(fallbackUrl, status) {
  return Boolean(fallbackUrl) && ORIGIN_FALLBACK_STATUSES.has(status);
}

/**
 * Is this error body safe to replay against the backup origin? — upstream
 * _origin_replay_safe, converter.py:5019-5023. A content-filter refusal, a confirmed
 * channel rejection, or any business code that names a real account/model condition
 * must reach the caller as-is: replaying would either double-spend a call the
 * upstream already answered or hide the reason a credential is in trouble.
 *
 * @param {string|Uint8Array} raw - The error body, as bytes or text.
 * @returns {boolean}
 */
export function isOriginReplaySafe(raw) {
  // Upstream checks the content filter FIRST (converter.py:5020-5021) — a filter
  // refusal is the model's answer, and replaying it would double-spend the call.
  if (isFilterError(raw)) return false;
  if (isChannelCheckError(raw)) return false;
  const text = typeof raw === "string" ? raw : raw ? new TextDecoder().decode(raw) : "";
  if (!text) return true;
  // Any explicit business code means the upstream ANSWERED — a replay cannot help.
  // Two owned deviations from upstream's NO_FAILOVER set (converter.py:479-484):
  // 11102 (model not servable) — upstream keeps a dedicated console-confirmed
  // model failover for it, but it is still a model-scoped condition, never a
  // gateway one; 14018 (quota exhausted) — absent upstream's set because upstream
  // bills quota elsewhere, while Vela's gate law (gate.js:33) maps it to 429, and
  // replaying a quota refusal against the backup origin would double-spend the
  // account. Both are held deliberately.
  return !/(?:^|[^0-9])(?:11102|11128|11129|11134|11140|11148|11150|11158|14018)(?:[^0-9]|$)/.test(text);
}
