// Script insertion: put an injector script's turns into the translated body.
//
// Called from applyUserInjectors, which chatCore runs AFTER format translation
// and BEFORE upstream dispatch — the same seam the system-prompt injector
// rides, and the same seam scanInboundBody taps. That ordering is the
// contract: the turns land in the WIRE shape the provider will read
// (messages[] / input[] / contents[]), never in the client body, and the
// inbound guardrail scans them because it scans the body after this ran.
//
// Role shapes per format (mirrors translator/schema/roles.js):
//   • OpenAI chat         messages[]:         { role, content: string }
//   • OpenAI Responses    input[]:            { type:"message", role, content:[{type:"input_text",text}] }
//   • Claude              messages[]:         { role, content:[{ type:"text", text }] }
//   • Gemini / Vertex / Antigravity  {request?}.contents[]: { role:"user"|"model", parts:[{text}] }
//   • Kiro                conversationState.history[]/turns[]: {userInputMessage:{content}} |
//                                           {assistantResponseMessage:{content}}
//   • Ollama              messages[]:         { role, content: string }  (chat shape)
//
// IDEMPOTENCY — "no double-insert on retry". Two layers, because two kinds of
// retry exist:
//
//   1. THE MARKER travels with the turns. A symbol-keyed `_vela_inject_scripts`
//      array lists a stable fingerprint per applied script. Checked before any
//      insertion; written on every insertion.
//   2. WIRE RECOGNITION for a marker-less body. When the script's turns are
//      already present, contiguously and in order, in the conversation array,
//      the script is judged present and nothing is written. This is what saves
//      a retry that re-built a body without the marker but kept the history.
//
// THE MARKER NEVER CROSSES THE BOUNDARY. It is a NON-ENUMERABLE, Symbol-keyed
// property: invisible to Object.entries / JSON.stringify (so the request-detail
// cascade and the recordOutboundPayload copy reach no wire, and a provider
// cannot 400 on an unknown field) and not copied by translateRequest's
// `{...detectedBody}` spread — a forged body starts marker-less, and the
// turnsPresent layer recognises the history already there. A plain string key
// would have travelled straight onto the wire; that is the leak this avoids.
//
// FAIL-OPEN — nothing here throws to the caller. A body whose shape this
// module does not recognise is left untouched; the request proceeds exactly as
// it would have without the injector.

import { FORMATS } from "../transformer/translator/formats.js";
import { ROLE, GEMINI_ROLE } from "../transformer/translator/schema/roles.js";
import { RESPONSES_ITEM } from "../transformer/translator/schema/blocks.js";

export const SCRIPT_MARKER_KEY = Symbol.for("vela.inject.scriptMarker");

/** A small stable string id — FNV-1a over the script's turns. Stable across
 *  processes (no random salt), so a retry in another worker computes the same
 *  fingerprint for the same script. */
export function fingerprintTurns(turns) {
  const text = JSON.stringify(turns || []);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function readMarker(body) {
  try {
    const m = body?.[SCRIPT_MARKER_KEY];
    return Array.isArray(m) ? m : [];
  } catch {
    return [];
  }
}

// The marker is a NON-ENUMERABLE own property, not a plain symbol assignment.
// A plain symbol key would be enumerated by the `{...translatedBody}` spread in
// translateRequest (symbols are enumerable) and so would double into the forged
// body — harmless for idempotency, but there is no reason to copy it. Keeping it
// non-enumerable means a spread-copy starts marker-less, and turnsPresent (the
// second layer) recognises the already-forged body by its turns instead.
function writeMarker(body, fp) {
  try {
    const m = readMarker(body);
    if (m.includes(fp)) return;
    Object.defineProperty(body, SCRIPT_MARKER_KEY, {
      value: [...m, fp],
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    /* frozen/proxy — the wire-recognition layer still guards the next retry */
  }
}

function isKiroBody(body) {
  const cs = body?.conversationState;
  if (!cs || typeof cs !== "object") return false;
  return Array.isArray(cs.history) || !!cs.currentMessage?.userInputMessage;
}

/** The conversation array that receives the turns, or null when the body has
 *  none this module knows how to extend. */
function conversationSlot(body, format) {
  if (isKiroBody(body) || format === FORMATS.KIRO) {
    const cs = body.conversationState;
    if (!cs) return null;
    if (Array.isArray(cs.history)) return { kind: "kiro", arr: cs.history };
    if (Array.isArray(cs.turns)) return { kind: "kiro", arr: cs.turns };
    return null;
  }
  if (format === FORMATS.CLAUDE) {
    return Array.isArray(body.messages) ? { kind: "claude", arr: body.messages } : null;
  }
  if (format === FORMATS.GEMINI || format === FORMATS.GEMINI_CLI
    || format === FORMATS.VERTEX || format === FORMATS.ANTIGRAVITY) {
    const target = body?.request && typeof body.request === "object" ? body.request : body;
    return Array.isArray(target?.contents) ? { kind: "gemini", arr: target.contents } : null;
  }
  // OpenAI-shaped: Chat first, then Responses.
  if (Array.isArray(body?.messages)) return { kind: "chat", arr: body.messages };
  if (Array.isArray(body?.input)) return { kind: "responses", arr: body.input };
  return null;
}

function textOfEntry(kind, entry) {
  switch (kind) {
    case "chat": return typeof entry?.content === "string" ? entry.content : null;
    case "claude": {
      const c = entry?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.filter((b) => b && typeof b.text === "string").map((b) => b.text).join("\n");
      return null;
    }
    case "responses": {
      const c = entry?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.filter((b) => b && typeof b.text === "string").map((b) => b.text).join("\n");
      return null;
    }
    case "gemini": {
      const p = entry?.parts;
      if (Array.isArray(p)) return p.filter((x) => x && typeof x.text === "string").map((x) => x.text).join("\n");
      return null;
    }
    case "kiro": {
      const m = entry?.userInputMessage || entry?.assistantResponseMessage;
      return m && typeof m.content === "string" ? m.content : null;
    }
    default: return null;
  }
}

function roleOfEntry(kind, entry) {
  switch (kind) {
    case "gemini": return entry?.role === GEMINI_ROLE.MODEL ? ROLE.ASSISTANT : ROLE.USER;
    case "kiro": return entry?.assistantResponseMessage ? ROLE.ASSISTANT : ROLE.USER;
    case "responses": return entry?.type === RESPONSES_ITEM.MESSAGE || entry?.role ? entry.role : null;
    default: return entry?.role || null;
  }
}

/** Are the turns already present, contiguously and in order? */
function turnsPresent(slot, turns) {
  const { kind, arr } = slot;
  const n = turns.length;
  for (let i = 0; i + n <= arr.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const e = arr[i + j];
      if (roleOfEntry(kind, e) !== turns[j].role || textOfEntry(kind, e) !== turns[j].content) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function entryFor(kind, turn) {
  switch (kind) {
    case "chat": return { role: turn.role, content: turn.content };
    case "claude": return { role: turn.role, content: [{ type: "text", text: turn.content }] };
    case "responses": return { type: RESPONSES_ITEM.MESSAGE, role: turn.role, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: turn.content }] };
    case "gemini": return { role: turn.role === ROLE.ASSISTANT ? GEMINI_ROLE.MODEL : GEMINI_ROLE.USER, parts: [{ text: turn.content }] };
    case "kiro": return turn.role === ROLE.ASSISTANT
      ? { assistantResponseMessage: { content: turn.content } }
      : { userInputMessage: { content: turn.content } };
    default: return null;
  }
}

/**
 * Insert a script's turns as fake history. Returns true when the body was
 * changed (turns inserted) or the script was already present (idempotent
 * no-op counts as applied, so the caller logs one line, not zero), false when
 * the body shape could not take it or there was nothing to insert.
 *
 * GRAMMAR SAFETY — the turns are a closed user/assistant loop, so the history
 * stays well-formed only if the join is:
 *
 *   • Gemini / Vertex / Antigravity and Claude carry HISTORY as the
 *     conversation array (the system prompt lives in `system` / `systemInstruction`
 *     / the lead). A closed loop must therefore open on `user`, or the loop's
 *     first assistant turn sits against the previous exchange's assistant turn.
 *     A script whose first turn is assistant would begin the history with
 *     `model`/`assistant` — rejected by Gemini (contents[0].role must be
 *     "user") and by Claude (first turn must be user). Leading assistant turns
 *     are dropped; the first user turn opens.
 *
 *   • OpenAI chat / Responses and Ollama carry the SYSTEM message inside the
 *     conversation array itself. Here a leading user turn is the instruction a
 *     real conversation starts with, and consecutive assistant turns are legal.
 *     The loop is placed directly after the trailing system prefix — never at
 *     index 0 — so it sits after the system voice and before the live history,
 *     and a leading script-user turn separates the system text from whatever
 *     assistant turn follows.
 *
 * @returns {boolean}
 */
export function insertScriptTurns(body, format, turns) {
  try {
    if (!body || typeof body !== "object" || !Array.isArray(turns) || turns.length === 0) return false;

    const fp = fingerprintTurns(turns);
    if (readMarker(body).includes(fp)) return true;

    const slot = conversationSlot(body, format);
    if (!slot) return false;
    if (turnsPresent(slot, turns)) { writeMarker(body, fp); return true; }

    let entries = turns.map((t) => entryFor(slot.kind, t)).filter(Boolean);
    if (!entries.length) return false;

    // History-only arrays (Gemini, Claude) must open on a user turn.
    if (slot.kind === "gemini" || slot.kind === "claude") {
      const firstUser = turns.findIndex((t) => t.role === ROLE.USER);
      if (firstUser < 0) return false; // nothing that can open a history — fail-open, drop
      entries = entries.slice(firstUser);
    }

    slot.arr.splice(insertionIndex(slot), 0, ...entries);
    writeMarker(body, fp);
    return true;
  } catch {
    return false; // fail-open
  }
}

/** Where the closed loop begins: 0 for a history-only array (Gemini/Claude,
 *  whose system prompt is out-of-band), and just past the leading system
 *  message(s) for OpenAI chat / Responses, whose system voice lives INSIDE the
 *  array — so the loop lands after it rather than before it. */
function insertionIndex(slot) {
  if (slot.kind !== "chat" && slot.kind !== "responses") return 0;
  let i = 0;
  while (i < slot.arr.length) {
    const r = slot.arr[i]?.role;
    if (r === ROLE.SYSTEM || r === ROLE.DEVELOPER) i++;
    else break;
  }
  return i;
}

export const __test__ = { fingerprintTurns, conversationSlot, turnsPresent, entryFor };
