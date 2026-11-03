// Injector scripts: an operator injector that is not a system prompt but a
// short, ordered conversation — fake history layered onto the translated body
// just before dispatch.
//
// Today an injector is ONE system prompt with a position (prepend/append). A
// `kind: "script"` injector instead carries `turns`:
//
//   [{ role: "user" | "assistant", content: "…" }]
//
// inserted, in order, as if they were earlier turns of the conversation. A
// model that sees a few exchanges setting the tone answers in kind — the same
// lever a system prompt pulls, but shown rather than told.
//
// THREE PURITIES, so every caller judges a script by the same standard:
//
//   • normalizeScript  — the SHAPE, for the store/API/UI. Turns are trimmed,
//                        roles checked, the max kept. It never throws.
//   • expandScript     — the TEXT, `{{var}}` rendered. Shares buildVarMap with
//                        the system path (userInjectors.js), so built-ins and
//                        x-vela-inject-var-* overrides behave identically.
//   • parseTurnsJson   — the tolerant reader for a turns array coming back from
//                        a JSON column (a string, or already parsed).

export const INJECTOR_KINDS = ["system", "script"];
export const SCRIPT_ROLES = ["user", "assistant"];

/** Upper bounds. A script is a tone-setter, not a corpus: past a dozen turns a
 *  model starts treating them as the subject of the conversation, and every
 *  turn is prompt tokens the operator pays for on every request. */
export const MAX_SCRIPT_TURNS = 12;
export const MAX_SCRIPT_CONTENT = 8000;

/** The `kind` of an injector. Anything absent or unknown reads as "system" —
 *  today's behavior — so an old settings row is never reinterpreted. */
export function normalizeKind(raw) {
  return INJECTOR_KINDS.includes(raw) ? raw : "system";
}

/**
 * Coerce a turns value into a clean array. Returns null when the value is not
 * a list at all (the store reads that as a malformed script), an array
 * otherwise with each surviving turn `{ role, content }`.
 *
 * Strictness is deliberate: a turn carrying an unknown role or empty content
 * is DROPPED rather than repaired. Inventing a role the wire shape does not
 * have would corrupt a translated body; dropping a turn merely leaves the
 * script shorter than intended.
 */
export function normalizeTurns(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const role = typeof t.role === "string" ? t.role.trim().toLowerCase() : "";
    if (!SCRIPT_ROLES.includes(role)) continue;
    const content = typeof t.content === "string" ? t.content.trim().slice(0, MAX_SCRIPT_CONTENT) : "";
    if (!content) continue;
    out.push({ role, content });
    if (out.length >= MAX_SCRIPT_TURNS) break;
  }
  return out;
}

/** Normalize a turns value that may arrive as a JSON string (a JSON column, or
 *  a multipart form field). Malformed JSON reads as null, never a throw. */
export function parseTurnsJson(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    try { return normalizeTurns(JSON.parse(s)); } catch { return null; }
  }
  return normalizeTurns(raw);
}

/**
 * The validation an operator deserves: a list of human reasons, empty when the
 * script is sound. Shape-level only — whether a var exists is dispatch's
 * question, and an unresolved {{x}} is rendered literally, never rejected.
 */
export function validateScriptTurns(raw) {
  const errors = [];
  if (raw != null && !Array.isArray(raw) && typeof raw !== "string") {
    errors.push("script turns must be an array");
    return errors;
  }
  // Role errors come FIRST, and are reported even when the drop would leave the
  // script empty — "needs at least one turn" is true but tells the operator
  // nothing; "may only be user or assistant" tells them what to fix.
  if (Array.isArray(raw)) {
    if (raw.length > MAX_SCRIPT_TURNS) errors.push(`script holds at most ${MAX_SCRIPT_TURNS} turns`);
    const roles = raw.filter((t) => t && typeof t === "object").map((t) => String(t.role || "").toLowerCase());
    if (roles.includes("system") || roles.includes("developer")) {
      // Anthropic rejects a system-role turn inside messages[], and every other
      // wire shape has no place for one in history. An operator who wants a
      // system voice uses a `system` injector — that kind still exists.
      errors.push("script turns may only be user or assistant; use a system injector for a system voice");
    }
  }
  const parsed = parseTurnsJson(raw);
  if (parsed === null) {
    if (raw != null) errors.push("script turns must be valid JSON array");
    return errors;
  }
  if (parsed.length === 0 && errors.length === 0) {
    errors.push("a script needs at least one turn");
  }
  return errors;
}

/** Render `{{var}}` in each turn's content. Empty results are dropped — a var
 *  that rendered to nothing leaves no turn behind to confuse a provider. */
/**
 * Validate the operator injector list before it is STORED (027) — the dashboard
 * form is not the only writer; a direct PATCH carries the same payload. Judge
 * it here, once, in one dialect — a `kind: "system"` entry (name + prompt), a
 * `kind: "script"` entry carries turns. An unknown kind reads as "system",
 * the fail-safe the injector itself applies.
 *
 * Returns a human reason, or null when the list is sound. (Lives HERE rather
 * than in the settings seam so that seam stays dependency-free — the log
 * retention worker imports it under bare Node, where `open-sse/...` does not
 * resolve.)
 */
export function validateUserInjectors(raw) {
  if (!Array.isArray(raw)) return "userInjectors must be an array";
  for (let i = 0; i < raw.length; i++) {
    const inj = raw[i];
    if (!inj || typeof inj !== "object") return `userInjectors[${i}] must be an object`;
    const name = typeof inj.name === "string" ? inj.name.trim() : "";
    if (!name) return `userInjectors[${i}].name is required`;
    if (normalizeKind(inj.kind) === "script") {
      const errs = validateScriptTurns(inj.turns);
      if (errs.length) return `userInjectors[${i}] (${name}): ${errs.join("; ")}`;
    } else if (!(typeof inj.prompt === "string" && inj.prompt.trim())) {
      return `userInjectors[${i}] (${name}): prompt is required for a system injector`;
    }
  }
  return null;
}

export function expandScript(script, vars = {}) {
  const turns = parseTurnsJson(script?.turns);
  if (!turns) return [];
  const out = [];
  for (const t of turns) {
    const content = String(t.content || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
      const v = vars[name];
      return v !== undefined && v !== null ? String(v) : `{{${name}}}`;
    });
    if (content.trim()) out.push({ role: t.role, content });
  }
  return out;
}

export const __test__ = { normalizeKind, normalizeTurns, parseTurnsJson, validateScriptTurns, expandScript };
