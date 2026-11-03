// User-defined prompt injectors: operator-configured named prompts appended
// (or prepended) to the system message of the final request body, just before
// dispatch — riding the same injectSystemPrompt seam as caveman/ponytail.
//
// Settings shape (settings.userInjectors):
//   [ { name, enabled, prompt, position: "append"|"prepend", applyTo: "llm"|"*" } ]
//
// - position "prepend" puts the injector BEFORE the existing system content
//   (useful for instructions the model should weigh first).
// - applyTo filters by service kind: "llm" (default) applies only to chat
//   completions; "*" applies everywhere the injector seam runs.
// - kind: "system" (default) is the system prompt above. kind: "script" holds
//   `turns: [{ role: "user"|"assistant", content }]` instead, inserted as fake
//   history into the translated body BEFORE dispatch (scriptInject.js). A
//   script is not a scanner: it produces no findings and never triggers a
//   guardrail refusal — the inbound tap still scans the body it lands in, but
//   the script itself only adds text.
// Fail-open: missing/malformed entries are skipped, never break the request.

import { injectSystemPrompt, captureSystemText } from "./systemInject.js";
import { normalizeKind, expandScript } from "./injectorScripts.js";
import { insertScriptTurns } from "./scriptInject.js";

const VALID_POSITIONS = new Set(["append", "prepend"]);

function normalizeInjector(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : null;
  const kind = normalizeKind(raw.kind);
  if (!name) return null;

  // A script injector carries turns in place of a prompt. Its turns are the
  // script; a missing list empties it, which the caller treats as skip.
  if (kind === "script") {
    return {
      name,
      kind,
      turns: Array.isArray(raw.turns) ? raw.turns : [],
      enabled: raw.enabled !== false,
      applyTo: raw.applyTo === "*" ? "*" : "llm",
      variables: raw.variables && typeof raw.variables === "object" ? raw.variables : undefined,
    };
  }

  const prompt = typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : null;
  if (!prompt) return null;
  return {
    name,
    kind,
    prompt,
    enabled: raw.enabled !== false,
    position: VALID_POSITIONS.has(raw.position) ? raw.position : "append",
    applyTo: raw.applyTo === "*" ? "*" : "llm",
    // v2: operator custom variables — { name: defaultValue }, overridable
    // per-request via x-vela-inject-var-<name> headers. Kept as-is.
    variables: raw.variables && typeof raw.variables === "object" ? raw.variables : undefined,
  };
}

/** Normalize an operator-supplied injector list. Always returns an array. */
export function normalizeUserInjectors(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeInjector).filter(Boolean);
}

/**
 * Build the variable map for an injector. Built-ins come from ctx; operator
 * custom variables (injector.variables) can be overridden per-request via
 * `x-vela-inject-var-<name>` headers (ctx.headers, case-insensitive).
 */
function buildVarMap(injector, ctx = {}) {
  const map = {
    date: ctx.date || new Date().toISOString().slice(0, 10),
    time: ctx.time || new Date().toISOString().slice(11, 19),
    model: ctx.model != null ? String(ctx.model) : "",
    kind: ctx.kind || "llm",
    keyPrefix: ctx.keyPrefix != null ? String(ctx.keyPrefix) : "",
    requestId: ctx.requestId != null ? String(ctx.requestId) : "",
    userAgent: ctx.userAgent != null ? String(ctx.userAgent) : "",
  };
  // Operator custom variables (injector.variables = { name: defaultValue }).
  const custom = injector.variables && typeof injector.variables === "object" ? injector.variables : {};
  for (const [k, v] of Object.entries(custom)) {
    map[k] = v != null ? String(v) : "";
  }
  // Per-request overrides via headers: x-vela-inject-var-<name>.
  const headers = ctx.headers && typeof ctx.headers.forEach === "function" ? ctx.headers : null;
  if (headers) {
    headers.forEach((value, key) => {
      const lower = String(key).toLowerCase();
      const m = lower.match(/^x-vela-inject-var-(.+)$/);
      if (m) map[m[1]] = String(value);
    });
  }
  return map;
}

/** Expand {{token}} placeholders in a prompt string against a var map. */
function expandVars(str, vars) {
  return String(str || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const v = vars[name];
    return v !== undefined && v !== null ? String(v) : `{{${name}}}`;
  });
}

/**
 * Apply user injectors to the final body. Returns the number applied.
 * - Entries are normalized inline — callers (chatCore) pass raw settings
 *   entries, so missing applyTo/position/enabled fall back to defaults.
 * - applyTo "*" applies unconditionally; "llm" applies to chat completions.
 * - ctx carries the live-context variables: model, kind, keyPrefix, requestId,
 *   userAgent, headers (Headers instance), date, time.
 * - Security (LLM07 prompt-leakage guard): built-in {{userAgent}} is surfaced
 *   for transparency but operator prompts are rendered AFTER user content is
 *   isolated; we never inject gateway secrets into user-visible output.
 */
export function applyUserInjectors(body, format, { injectors = [], kind = "llm", log = null, ctx = null } = {}) {
  if (!body || !Array.isArray(injectors) || injectors.length === 0) return 0;
  let applied = 0;
  for (const raw of injectors) {
    const inj = normalizeInjector(raw);
    if (!inj || !inj.enabled) continue;
    if (inj.applyTo !== "*" && inj.applyTo !== kind) continue;
    const vars = buildVarMap(inj, { ...(ctx || {}), kind });

    if (inj.kind === "script") {
      // Scripts are not scanners: nothing here produces findings or a refusal.
      // They insert fake history into the translated body and that is all.
      const turns = expandScript(inj, vars);
      if (!turns.length) {
        log?.warn?.("INJECT", `${inj.name} (script) skipped — no usable turns`);
        continue;
      }
      if (insertScriptTurns(body, format, turns)) {
        applied += 1;
        log?.info?.("INJECT", `${inj.name} (script · ${turns.length} turn${turns.length === 1 ? "" : "s"})`);
      }
      continue;
    }

    const rendered = expandVars(inj.prompt, vars);
    const before = captureSystemText(body, format);
    injectSystemPrompt(body, format, rendered, inj.position);
    if (captureSystemText(body, format) !== before) {
      applied += 1;
      log?.info?.("INJECT", `${inj.name} (${inj.position})${/\{\{/.test(rendered) ? " [unresolved vars]" : ""}`);
    }
  }
  return applied;
}

// captureSystemText moved to systemInject.js so the policy stack and the
// operator injectors share ONE change detector; re-exported so existing
// importers keep their binding.
export { captureSystemText };

export const __test__ = { normalizeInjector };
