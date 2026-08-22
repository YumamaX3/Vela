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
// Fail-open: missing/malformed entries are skipped, never break the request.

import { injectSystemPrompt } from "./systemInject.js";

const VALID_POSITIONS = new Set(["append", "prepend"]);

function normalizeInjector(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : null;
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : null;
  if (!name || !prompt) return null;
  return {
    name,
    prompt,
    enabled: raw.enabled !== false,
    position: VALID_POSITIONS.has(raw.position) ? raw.position : "append",
    applyTo: raw.applyTo === "*" ? "*" : "llm",
  };
}

/** Normalize an operator-supplied injector list. Always returns an array. */
export function normalizeUserInjectors(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeInjector).filter(Boolean);
}

/**
 * Apply user injectors to the final body. Returns the number applied.
 * - Entries are normalized inline — callers (chatCore) pass raw settings
 *   entries, so missing applyTo/position/enabled fall back to defaults.
 * - applyTo "*" applies unconditionally; "llm" applies to chat completions
 *   (the caller passes kind — "llm" is the only kind this seam reaches today,
 *   but the shape is future-proof).
 */
export function applyUserInjectors(body, format, { injectors = [], kind = "llm", log = null } = {}) {
  if (!body || !Array.isArray(injectors) || injectors.length === 0) return 0;
  let applied = 0;
  for (const raw of injectors) {
    const inj = normalizeInjector(raw);
    if (!inj || !inj.enabled) continue;
    if (inj.applyTo !== "*" && inj.applyTo !== kind) continue;
    const before = captureSystemText(body, format);
    injectSystemPrompt(body, format, inj.prompt, inj.position);
    if (captureSystemText(body, format) !== before) {
      applied += 1;
      log?.info?.("INJECT", `${inj.name} (${inj.position})`);
    }
  }
  return applied;
}

// Capture the system text for change detection (same shapes systemInject touches).
function captureSystemText(body, format) {
  try {
    const target = body?.request && typeof body.request === "object" ? body.request : body;
    if (typeof body?.instructions === "string") return `instructions:${body.instructions}`;
    const arr = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : null;
    if (arr) {
      const sys = arr.find((m) => m && (m.role === "system" || m.role === "developer"));
      if (sys && typeof sys.content === "string") return `msg:${sys.content}`;
      if (sys && Array.isArray(sys.content)) return `arr:${sys.content.length}`;
    }
    if (typeof target?.system === "string") return `sys:${target.system}`;
    if (Array.isArray(target?.system)) return `sysArr:${target.system.length}`;
    const sysKey = Object.prototype.hasOwnProperty.call(target, "system_instruction") ? "system_instruction" : "systemInstruction";
    const sys = target?.[sysKey];
    if (sys && Array.isArray(sys.parts)) return `gem:${sys.parts.length}`;
  } catch { /* fail-open */ }
  return "";
}

export const __test__ = { normalizeInjector };
