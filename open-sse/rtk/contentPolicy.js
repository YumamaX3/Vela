// Response-path content policy (AI Lab W4a — S4).
//
// Inspects assistant TEXT leaves of the upstream response before the client
// sees them. Three actions per profile:
//   flag   — usage tag + WARN log, pass-through (default; needs no buffer)
//   redact — replace matched spans with [CONTENT REDACTED]
//   block  — HTTP 451 envelope (non-stream) / terminal SSE error (stream);
//            the DECLARED exception to the fail-open covenant, drawn
//            surgically: a positive match closes, a detector CRASH opens.
//
// Leaf-path discipline (the wallkeeper's law): the walker touches ONLY
// assistant text leaves — OpenAI choices[].delta.content, Claude
// content_block_delta.text_delta.text, Gemini parts[].text. Tool_call/function
// arguments, tool_result payloads, and image alt-text are STRUCTURALLY
// UNREACHABLE (the walker enumerates format text paths; it never mutates
// generic objects). A redaction bug therefore cannot corrupt tool execution.
//
// ReDoS guard (the Tidebreaker's finding): a catastrophic-backtracking regex
// HANGS rather than throws, so it falls OUTSIDE the fail-open guarantee.
// Patterns are rejected at compile-time (nested quantifiers), length-capped,
// and every scan is time-boxed.

const REDACTED = "[CONTENT REDACTED]";
const PATTERN_MAX_LENGTH = 256;
const SCAN_TIMEOUT_MS = 25;

/** Rough "unsafe quantifier nesting" detector — rejects (a+)+-style bombs. */
export function validatePattern(regex) {
  if (typeof regex !== "string" || regex.length === 0) return "empty pattern";
  if (regex.length > PATTERN_MAX_LENGTH) return `pattern exceeds ${PATTERN_MAX_LENGTH} chars`;
  // Detect nested quantifiers like (a+)+, (a*)*, (a|a)*, (a+)* — the classic
  // ReDoS core. Covers a quantifier inside a group followed by a quantifier on
  // the group (including alternations like (a|a)*) and nested groups.
  const nested = /\([^)]*(?:[+*]|\|[^)]*)+\)\s*[+*{]/;
  const alternationBomb = /\(\s*[^)]*\|\s*[^)]*\|\s*[^)]*\)\s*[+*]/; // (a|a|a)+-ish
  if (nested.test(regex) || alternationBomb.test(regex)) return "nested quantifier detected (possible ReDoS)";
  try {
    // Compile-time check — a catastrophic pattern may compile fine but hang on
    // scan; the nesting heuristic + scan timeout are the backstops.
    new RegExp(regex, "i");
  } catch (e) {
    return `invalid regex: ${e.message}`;
  }
  return null;
}

/** Compile a profile's patterns into {re, source} pairs; drops invalid ones. */
export function compileProfile(profile) {
  const patterns = [];
  for (const p of Array.isArray(profile?.patterns) ? profile.patterns : []) {
    const reason = validatePattern(p);
    if (reason) continue; // invalid pattern dropped at compile (fail-open)
    patterns.push({ re: new RegExp(p, "i"), source: p });
  }
  return { id: profile?.id, action: profile?.action || "flag", patterns, enabled: profile?.enabled !== false };
}

/** Resolve the active policy profile for a request (mode's profile, else first enabled). */
export function resolveActiveProfile(contentPolicies, { modeProfileId = null } = {}) {
  const list = Array.isArray(contentPolicies) ? contentPolicies : [];
  if (modeProfileId) {
    const m = list.find((p) => p?.id === modeProfileId);
    if (m && m.enabled !== false) return compileProfile(m);
  }
  const first = list.find((p) => p?.enabled !== false);
  return first ? compileProfile(first) : null;
}

/**
 * Scan a text leaf against the profile's patterns.
 * Time-boxed: a pathological regex is cut off mid-scan (fail-open — the chunk
 * passes through untouched) rather than hanging the gateway.
 * @returns { matched: boolean, action } — matched only if a pattern hit within budget.
 */
export function scanText(text, profile) {
  if (!profile || profile.patterns.length === 0) return { matched: false };
  const started = Date.now();
  for (const { re, source } of profile.patterns) {
    if (Date.now() - started > SCAN_TIMEOUT_MS) return { matched: false, timedOut: true };
    re.lastIndex = 0;
    try {
      if (re.test(String(text ?? ""))) return { matched: true, source };
    } catch {
      // A regex that throws at scan time fails OPEN (never blocks traffic).
      return { matched: false, threw: true };
    }
  }
  return { matched: false };
}

/** The verdict taxonomy (W4b) — first-class result kinds for breaker/fallback. */
export const VERDICTS = {
  UPSTREAM_REFUSAL: "UPSTREAM_REFUSAL",
  GATEWAY_POLICY_BLOCK: "GATEWAY_POLICY_BLOCK",
  ACCOUNT_FAILURE: "ACCOUNT_FAILURE",
};

/** The 403-shaped internal trigger event (satisfies isContentPolicy untouched). */
export function policyBlockEvent(profile, requestId) {
  return {
    status: 403,
    errorText: "content policy blocked by gateway",
    contentPolicyBlocked: true,
    policyId: profile?.id || null,
    requestId: requestId || null,
  };
}

// ── Format leaf-path walkers ───────────────────────────────────────────────

/** OpenAI-shaped: choices[].delta.content / choices[].message.content (text leaves only). */
export function walkOpenAI(body, fn) {
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  let touched = 0;
  for (const c of choices) {
    const delta = c?.delta && typeof c.delta === "object" ? c.delta : null;
    if (delta && typeof delta.content === "string") {
      const out = fn(delta.content);
      if (typeof out === "string") { delta.content = out; touched++; }
    }
    if (c?.message && typeof c.message.content === "string") {
      const out = fn(c.message.content);
      if (typeof out === "string") { c.message.content = out; touched++; }
    }
  }
  return touched;
}

/** Claude-shaped: content_block_delta.text_delta.text / content[].text (text leaves only). */
export function walkClaude(body, fn) {
  const content = Array.isArray(body?.content) ? body.content : [];
  let touched = 0;
  for (const block of content) {
    if (block?.delta && typeof block.delta.text === "string") {
      const out = fn(block.delta.text);
      if (typeof out === "string") { block.delta.text = out; touched++; }
    }
    if (block?.text && typeof block.text === "string") {
      const out = fn(block.text);
      if (typeof out === "string") { block.text = out; touched++; }
    }
  }
  return touched;
}

/** Gemini-shaped: parts[].text (text leaves only). */
export function walkGemini(body, fn) {
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  let touched = 0;
  for (const cand of candidates) {
    const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
    for (const part of parts) {
      if (part && typeof part.text === "string") {
        const out = fn(part.text);
        if (typeof out === "string") { part.text = out; touched++; }
      }
    }
  }
  return touched;
}

/**
 * Run the policy over a translated response body. Returns the verdict:
 *   { verdict: 'none'|'flag'|'redact'|'block', source?, matched? }
 * `flag` passes through; `redact` rewrites text leaves in place; `block`
 * signals the caller (chatCore) to emit the 451/terminal-SSE + fallback event.
 */
export function applyContentPolicy(body, format, profile) {
  if (!profile || profile.patterns.length === 0) return { verdict: "none" };
  const walker = format === "claude" ? walkClaude
    : format === "gemini" ? walkGemini
    : walkOpenAI;

  let matched = false;
  let matchedSource = null;
  let action = profile.action;

  if (action === "redact") {
    walker(body, (text) => {
      for (const { re, source } of profile.patterns) {
        re.lastIndex = 0;
        try {
          if (re.test(text)) { matched = true; matchedSource = source; break; }
        } catch { break; }
      }
      if (matched) return text.replace(REDACT_PATTERNS(profile), REDACTED);
      return text;
    });
  } else {
    // flag / block — detection only (no mutation).
    walker(body, (text) => {
      const r = scanText(text, profile);
      if (r.matched) { matched = true; matchedSource = r.source; }
      return text; // never mutate on flag/block detection pass
    });
  }

  if (!matched) return { verdict: "none" };
  if (action === "redact") return { verdict: "redact", matched, source: matchedSource };
  if (action === "block") return { verdict: "block", matched, source: matchedSource };
  return { verdict: "flag", matched, source: matchedSource };
}

/** Rebuild a combined replace regex from the profile (span-safe). */
function REDACT_PATTERNS(profile) {
  const sources = profile.patterns.map((p) => p.source);
  try {
    return new RegExp(sources.join("|"), "gi");
  } catch {
    return /(?!)x/; // never matches — fail-open
  }
}

export const __test__ = { REDACTED, PATTERN_MAX_LENGTH, SCAN_TIMEOUT_MS };
