// tool_choice, flattened for the CodeBuddy wire.
//
// The CodeBuddy-family upstream is a Go gateway that accepts `tool_choice` only as
// a STRING ("auto" | "none" | "required" | <tool name>). Anthropic-shaped clients
// send the OpenAI object form instead:
//
//   { type: "function", function: { name: "get_weather" } }
//
// and the upstream answers 400 / business code 11101 — proven live four times on
// the family lanes. The defect is one of wire shape, not of intent: the request
// always meant "call this function" or "pick one yourself". This module restates
// the intent in the only grammar the shore reads.
//
// The mapping is total and pure — every input shape has exactly one answer:
//
//   {type:"function", function:{name:"f"}}  → "f"        the named function
//   {type:"function"}  / {name-less}        → "auto"     no name to pin; let it choose
//   {type:"auto"}                           → "auto"
//   {type:"none"}                           → "none"
//   {type:"required"}                       → "required"
//   "auto" | "none" | "required" | "f"      → unchanged  already the upstream grammar
//   undefined                               → undefined  the key stays absent
//
// Anything this function does not recognise (null, a number, an object with no
// string `type`) is returned as "auto": the request still wanted tools, and a
// permissive choice is the one answer the upstream accepts that never narrows the
// client's intent to a function that does not exist.

/** The three bare directives the upstream understands, as a set for O(1) checks. */
const DIRECTIVES = new Set(["auto", "none", "required"]);

/**
 * Flatten a client `tool_choice` into the string form the CodeBuddy gateway reads.
 *
 * @param {unknown} toolChoice - whatever the client sent
 * @returns {string|undefined} the string to send, or undefined to leave the key absent
 */
export function normalizeToolChoice(toolChoice) {
  // Absent stays absent: sending `tool_choice: "auto"` where the client sent
  // nothing would turn tools on for every request that merely carries the field's
  // absence — the same class of overreach as forcing reasoning_effort (#2071).
  if (toolChoice === undefined) return undefined;

  // A string is already the upstream grammar — directive or function name alike.
  if (typeof toolChoice === "string") return toolChoice;

  if (toolChoice && typeof toolChoice === "object") {
    const type = toolChoice.type;
    if (DIRECTIVES.has(type)) return type;
    if (type === "function") {
      const name = toolChoice.function?.name;
      return typeof name === "string" && name.length > 0 ? name : "auto";
    }
  }

  // Unrecognised shapes (null, numbers, `{type:"web_search"}`-style entries that the
  // family does not serve): permissive, never a broken wire.
  return "auto";
}

/**
 * Apply the normalisation in place on a request body and return it.
 *
 * In place rather than by copy: `transformRequest` threads one body object through
 * the whole build, and a shallow copy here would be a second body the caller never
 * sees. Only the family executor calls this, so no other provider's wire is touched.
 *
 * @template T
 * @param {T} body
 * @returns {T}
 */
export function applyToolChoiceNormalization(body) {
  if (!body || typeof body !== "object") return body;
  if (!("tool_choice" in body)) return body;
  const normalized = normalizeToolChoice(body.tool_choice);
  if (normalized === undefined) {
    delete body.tool_choice;
  } else {
    body.tool_choice = normalized;
  }
  return body;
}
