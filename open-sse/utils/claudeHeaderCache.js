/**
 * Singleton cache for the REAL Claude Code client identity headers.
 *
 * Vela fabricates the client identity it presents to Anthropic: a hardcoded
 * `claude-cli/<version>` user-agent in `providers/shared.js` and
 * `providers/registry/claude.js`. When a genuine Claude Code client talks to
 * Vela, its own headers are strictly better evidence of who is calling — this
 * module captures them from the inbound request so the executor can forward
 * them upstream instead of the spoof.
 *
 * ── Port notes (W6, sibling-harbor-ports §3.1 row 8) ─────────────────────────
 * Ported from VansRouter's `open-sse/utils/claudeHeaderCache.js`.
 *
 * SECURITY (plan §5a). The cache stores only the header *shape* needed for
 * forwarding — an allow-list of client-identity headers — and a hard deny-list
 * (`authorization`, `x-api-key`, `cookie`, `set-cookie`, `proxy-authorization`)
 * is applied on top of the allow-list, so a future edit to the allow-list
 * cannot silently start caching a credential. Nothing here logs a header value;
 * the one log line carries a count. `getCachedClaudeHeaders()` returns a copy,
 * so a caller cannot mutate the singleton.
 *
 * @module open-sse/utils/claudeHeaderCache
 */

/**
 * The client-identity header shape that is worth forwarding to
 * api.anthropic.com. Deliberately excludes every credential-bearing header.
 */
const CLAUDE_IDENTITY_HEADERS = [
  "user-agent",
  "anthropic-beta",
  "anthropic-version",
  "anthropic-dangerous-direct-browser-access",
  "x-app",
  "x-stainless-helper-method",
  "x-stainless-retry-count",
  "x-stainless-runtime-version",
  "x-stainless-package-version",
  "x-stainless-runtime",
  "x-stainless-lang",
  "x-stainless-arch",
  "x-stainless-os",
  "x-stainless-timeout",
  "x-claude-code-session-id",
  "package-version",
  "runtime-version",
  "os",
  "arch",
];

/**
 * Credential-bearing headers that must NEVER be cached, logged or forwarded
 * from a client request. Applied as a second gate after the allow-list.
 */
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

const ALLOWED = new Set(CLAUDE_IDENTITY_HEADERS);

let cachedHeaders = null;

/**
 * Detect if request headers look like a real Claude Code client.
 * @param {object} headers - Lowercase header key/value object
 * @returns {boolean}
 */
function isClaudeCodeClient(headers) {
  const ua = String(headers["user-agent"] || "").toLowerCase();
  const xApp = String(headers["x-app"] || "").toLowerCase();
  return ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli";
}

/**
 * Store Claude Code identity headers if this looks like a real client request.
 * Called at the request entry point, before any translation/forwarding.
 *
 * @param {object} headers - Lowercase header key/value object (e.g. from
 *   `Object.fromEntries(request.headers.entries())`); also accepts a `Headers`.
 * @param {{log?: {debug?: Function, info?: Function}|null}} [options]
 * @returns {boolean} true when headers were captured
 */
export function cacheClaudeHeaders(headers, options = {}) {
  const plain = toPlainHeaderObject(headers);
  if (!plain) return false;
  if (!isClaudeCodeClient(plain)) return false;

  const captured = {};
  for (const key of CLAUDE_IDENTITY_HEADERS) {
    if (CREDENTIAL_HEADERS.has(key)) continue; // deny-list wins over allow-list
    const value = plain[key];
    if (value !== undefined && value !== null) captured[key] = value;
  }
  if (Object.keys(captured).length === 0) return false;

  cachedHeaders = Object.freeze(captured);
  // Count only — a header VALUE never reaches a log sink.
  const line = `[ClaudeHeaders] Cached ${Object.keys(captured).length} identity headers from Claude Code client`;
  try {
    const log = options?.log;
    if (typeof log?.debug === "function") log.debug(line);
    else if (typeof log?.info === "function") log.info(line);
    else console.log(line);
  } catch { /* logging must never break capture */ }
  return true;
}

/**
 * Get the most recently cached Claude Code identity headers.
 * Returns null if no authentic client request has been seen yet (cold start),
 * in which case callers keep their static fallback fingerprint.
 * @returns {object|null} a copy — mutating it cannot poison the singleton
 */
export function getCachedClaudeHeaders() {
  return cachedHeaders ? { ...cachedHeaders } : null;
}

/** Drop the cached headers. Test/reset seam. */
export function clearCachedClaudeHeaders() {
  cachedHeaders = null;
}

/** Exposed for tests and for the security invariant that the allow-list is closed. */
export const CLAUDE_IDENTITY_HEADER_ALLOWLIST = Object.freeze([...CLAUDE_IDENTITY_HEADERS]);
export const CLAUDE_CREDENTIAL_HEADER_DENYLIST = Object.freeze([...CREDENTIAL_HEADERS]);

/**
 * Normalize a Headers instance, a Map, or a plain object to a lowercase-keyed
 * plain object. Returns null for anything else.
 */
function toPlainHeaderObject(headers) {
  if (!headers || typeof headers !== "object") return null;
  if (typeof headers.entries === "function") {
    try {
      return Object.fromEntries(
        Array.from(headers.entries()).map(([k, v]) => [String(k).toLowerCase(), v]),
      );
    } catch {
      return null;
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = v;
  return Object.keys(out).length > 0 ? out : null;
}

export { ALLOWED as CLAUDE_IDENTITY_HEADER_SET };
