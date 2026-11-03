// GUARDRAIL PIPELINE — where a policy meets a request.
//
// policyStore.js answers WHICH policy wins and remembers WHAT matched. This
// module is the tap itself: it resolves a policy for one request, scans the
// body that is about to cross the boundary, and filters the answer on the way
// back. The engine stays pure; the store stays about storage; only this file
// knows the shape of Vela's traffic.
//
// THREE POSTURES, ported from 9router-go's `internal/guardrails`:
//
//   • FAIL-OPEN AT THE EDGES. A policy table that cannot be read, a settings
//     row that cannot be parsed, an audit write that fails — none of these may
//     take the harbor down. They degrade to "no policy", which is what an
//     unconfigured install already pays.
//
//   • BLOCK IS 451, NEVER 502. Vela's fallback classifier treats 5xx (and
//     specific 4xx) as credential failures and retries the next mooring. A
//     policy decision is not an upstream fault: the provider answered
//     correctly and the answer was still refused. 451 is outside every retry
//     rule, so the refusal reaches the client and no other account is asked to
//     repeat the very request that was blocked. Inbound uses 400, as the Go
//     middleware does: the request itself carries the violation.
//
//   • MASK REWRITES IN PLACE. An inbound mask hands the executor a body whose
//     strings already carry [REDACTED]; an outbound mask rewrites only the
//     text nodes of a stream, never its framing. Every other byte — event
//     names, ids, usage, finish reasons — is relayed untouched, because a
//     filter that re-encodes clean frames changes a stream for no reason.

import { resolvePolicy, listMatchingPolicies, logDecision, listEnabledPolicies } from "./policyStore.js";
import { metrics } from "../metrics.js";
import { engineFromPolicy } from "open-sse/guardrails/engine.js";
import { injectPromptStack } from "open-sse/rtk/systemInject.js";
import { expandScript } from "open-sse/rtk/injectorScripts.js";
import { insertScriptTurns } from "open-sse/rtk/scriptInject.js";
import { getSettings } from "../db/repos/settingsRepo.js";
import { resolveKey } from "../db/repos/apiKeysRepo.js";
import { buildStreamErrorBytes } from "open-sse/utils/streamHelpers.js";
import { buildAbortedResponsesTerminalBytes } from "open-sse/utils/responsesStreamHelpers.js";
import { FORMATS } from "open-sse/transformer/translator/formats.js";
import { recordSecurityAndTrust } from "@/lib/security/securityEvents.js";

export const BLOCK_STATUS = 451;
export const BLOCKED_INBOUND = "Request blocked by a configured guardrail policy.";
export const BLOCKED_OUTBOUND = "Response blocked by a configured guardrail policy.";

/** How much model text the outbound filter holds before judging it. A value
 *  routinely straddles two deltas ("billing@acme-" / "corp.com"); anything
 *  longer than this is not one entity, and holding more would re-scan a
 *  growing buffer on every chunk. */
const SCAN_WINDOW_CHARS = 512;

// ── Kill switch ─────────────────────────────────────────────────────────────

const SWITCH_TTL_MS = 5_000;
let switchCache = { value: true, at: 0 };

/**
 * The operator's global kill switch. Defaults ON, and ON again when the row
 * cannot be read: someone who configured a policy would rather survive a
 * transient read error with the filter working than silently lose it.
 */
export async function guardrailsEnabled() {
  const now = Date.now();
  if (now - switchCache.at < SWITCH_TTL_MS) return switchCache.value;
  let value = true;
  try {
    const settings = await getSettings();
    if (settings && settings.guardrailsEnabled === false) value = false;
  } catch {
    value = true;
  }
  switchCache = { value, at: now };
  return value;
}

/** Test seam and settings-write hook — clears the cached kill switch. */
export function invalidateSwitchCache() {
  switchCache = { value: true, at: 0 };
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve the engine that governs one direction of one request.
 *
 * `apiKey` is the raw client key. It is turned into a key id ONLY when an
 * apikey-scoped policy actually exists — resolving the row on every request
 * would add a hash + lookup to the hot path for an install that never scopes
 * that way. The raw key is never stored on a policy and never logged.
 *
 * @returns {Promise<{engine: object, policy: object|null}|null>} null when the
 *          switch is off or no policy applies
 */
export async function resolveGuardrail({ provider, model, chain, apiKey, direction }) {
  if (!(await guardrailsEnabled())) return null;

  let apiKeyId = null;
  try {
    if (apiKey) {
      const enabled = await listEnabledPolicies();
      if (enabled.some((p) => p.scope === "apikey")) {
        const row = await resolveKey(apiKey);
        apiKeyId = row?.id || null;
      }
    }
  } catch {
    apiKeyId = null; // fail-open: an unresolvable key only loses the scope
  }

  const ctx = { provider, model, chain, apiKeyId, direction };
  const policy = await resolvePolicy(ctx);
  const engine = engineFromPolicy(policy);
  const scanEnabled = Boolean(policy) && engine.enabled();

  // Pro's grouped pass: prompt CONTENT is resolved additively alongside the
  // one-winner scan. Only an inbound stack has anywhere to land (the request's
  // own system text); an outbound policy carries no request to prepend to.
  let promptStack = [];
  let scriptStack = [];
  if (direction === "inbound") {
    try {
      const matching = await listMatchingPolicies(ctx);
      promptStack = matching.filter((p) => p.prompt);
      // 027 — script policies instruct rather than scan. They ride the same
      // grouped pass, but a script with no detectors and no prompt would
      // otherwise be invisible to the return gate below (`detectors: []` is
      // silent, not "scan everything"), so it is collected here and counted.
      scriptStack = matching.filter((p) => p.kind === "script" && Array.isArray(p.turns) && p.turns.length > 0);
    } catch {
      promptStack = []; // fail-open: an unreadable table stacks nothing
      scriptStack = [];
    }
  }

  // An engine would say it is enabled for "allow" + detectors (warn/log_only
  // postures still record findings), so the return gate is the scan's own.
  if (!scanEnabled && !promptStack.length && !scriptStack.length) return null;
  return { engine, policy, promptStack, scriptStack };
}

/**
 * Apply the grouped pass: every matching policy's prompt, in stack order
 * (global → apikey → model), prepends as one burst ahead of the system text
 * and appends as one at the end. Mutates the body in place and reports what
 * landed. Fail-open — a stack that cannot be read or merged changes nothing.
 *
 * @returns {number} how many prompts the body did not already carry
 */
export function applyPromptStack(guardrail, body, format) {
  const stack = guardrail?.promptStack;
  if (!Array.isArray(stack) || stack.length === 0) return 0;
  try {
    const items = stack
      .filter((p) => p && p.prompt)
      .map((p) => ({ prompt: p.prompt, position: p.promptPosition || "append" }));
    return injectPromptStack(body, format, items);
  } catch {
    return 0; // fail-open
  }
}

/**
 * Apply the grouped SCRIPT pass (027): every matching inbound policy with
 * `kind: "script"` inserts its turns as fake history, in stack order. A script
 * is not a scanner — it adds no finding and can never block; the inbound tap
 * already judged the body without it, and the script's own text is not what a
 * detector was asked about. Variables ({{model}}, {{date}}, custom vars and
 * x-vela-inject-var-* overrides) render at dispatch through the same map the
 * system path uses, so a script and a system prompt name the model identically.
 *
 * Fail-open throughout: a malformed script, an unknown wire shape, or a body
 * that already carries the turns simply contributes nothing.
 *
 * @returns {number} how many scripts landed (inserted or already present)
 */
export function applyScriptStack(guardrail, body, format, ctx = {}) {
  const stack = guardrail?.scriptStack;
  if (!Array.isArray(stack) || stack.length === 0) return 0;
  // Merge FIRST, insert ONCE. Inserting script-by-script would have each
  // splice land at the same index, reversing the run (the second script would
  // arrive ahead of the first). One combined array also gives one fingerprint
  // for the whole run, so a retry recognises it whether or not the marker
  // survived, and no two scripts can interleave mid-insertion.
  const combined = [];
  let landed = 0;
  for (const policy of stack) {
    try {
      const turns = expandScript({ turns: policy.turns }, ctx);
      if (turns.length) { combined.push(...turns); landed += 1; }
    } catch {
      /* fail-open: one bad script never stops the others or the request */
    }
  }
  if (!combined.length) return 0;
  return insertScriptTurns(body, format, normalizeSeams(combined)) ? landed : 0;
}

/**
 * Keep the merged run a grammatically sound user/assistant alternation.
 *
 * Each script is internally a closed loop, but two loops joined end-to-end can
 * collide at the seam: [user, assistant] + [assistant, user] yields
 * `assistant, assistant`, and [user] + [user] yields `user, user`. Claude
 * rejects consecutive same-role turns; Gemini tolerates them poorly. A turn
 * whose role would repeat its predecessor is dropped — the first of the two
 * survives, so a script's opening line is never what disappears.
 */
function normalizeSeams(turns) {
  const out = [];
  for (const t of turns) {
    if (out.length && out[out.length - 1].role === t.role) continue;
    out.push(t);
  }
  return out;
}

// ── Audit ───────────────────────────────────────────────────────────────────

/**
 * A BLOCK is also a security act. Fail-open, never awaited, and metadata-only:
 * the detectors + entities that fired (names, never the matched values), the
 * direction, the provider/model and the policy id — exactly what the audit row
 * already holds, and nothing the block protected. It reaches the trust inbox
 * too, because a guardrail refusing traffic is the operator's business the
 * moment it happens. A block is NOT hot-path coalesced the way rate denials
 * are (securityEvents.js): each refusal is a discrete event.
 */
function recordGuardrailBlock({ guardrail, decision, direction, provider, model }) {
  try {
    const findings = decision?.findings || [];
    if (!findings.length) return;
    const entities = [...new Set(findings.map((f) => f.entity).filter(Boolean))].sort();
    const detectors = [...new Set(findings.map((f) => f.detector).filter(Boolean))].sort();
    const detail = {
      policyId: guardrail?.policy?.id || null,
      direction,
      provider: provider || null,
      model: model || null,
      detectors,
      entities,
      findings: findings.length,
    };
    recordSecurityAndTrust(
      { keyId: null, kind: "guardrail.block", detail, ip: null },
      {
        trustKind: "guardrail.block",
        title: `Guardrail blocked ${direction === "inbound" ? "a request" : "a response"}`,
        trustDetail: detail,
      }
    );
  } catch {
    // Fail-open — a security line must never turn a filter into a client error.
  }
}

/**
 * Record what a guardrail decided. Never blocks, never throws: the decision
 * already happened, and an audit table that fails must not turn a filter into
 * a client error.
 */
export function auditDecision({ guardrail, decision, direction, provider, model, connectionId, excerpt = null }) {
  if (!guardrail || !decision || !decision.findings?.length) return;
  if (decision.action === "block") recordGuardrailBlock({ guardrail, decision, direction, provider, model });
  for (const finding of decision.findings) {
    metrics.recordGuardrailDecision({
      detector: finding.detector || "unknown",
      action: decision.action || "allow",
      direction,
    });
  }
  logDecision({
    policy: guardrail.policy,
    direction,
    decision,
    provider,
    model,
    connectionId,
    excerpt,
  }).catch(() => { /* the log must never break the request */ });
}

// ── Inbound ─────────────────────────────────────────────────────────────────

/**
 * Scan a decoded request body. The caller has already parsed it, so rewriting
 * string leaves in place avoids re-serialising a structure the gateway does
 * not understand.
 *
 * @returns {{action: string, findings: object[], mutated: boolean, value: any}}
 */
export function scanInboundBody(guardrail, body) {
  if (!guardrail?.engine?.enabled?.()) {
    return { action: "allow", findings: [], mutated: false, value: body };
  }
  const started = performance.now();
  const result = guardrail.engine.scanJSON(body);
  metrics.observeGuardrailEval("inbound", (performance.now() - started) / 1000);
  return result;
}

// ── Outbound, buffered ──────────────────────────────────────────────────────

/**
 * Scan a translated, non-streamed response as one document. Returns the value
 * to relay: the same object when nothing matched, a rewritten one when a mask
 * fired. The caller decides whether a block becomes a 451.
 */
export function scanOutboundPayload(guardrail, payload) {
  if (!guardrail?.engine?.enabled?.()) {
    return { action: "allow", findings: [], mutated: false, value: payload };
  }
  const started = performance.now();
  const result = guardrail.engine.scanJSON(payload);
  metrics.observeGuardrailEval("outbound", (performance.now() - started) / 1000);
  return result;
}

// ── Outbound, streamed ──────────────────────────────────────────────────────

// Text nodes are found by shape, not by walking every string: a whole-payload
// scan would judge ids, model names and finish reasons, and a detector that
// fired there would redact metadata the client needs to read the frame.
function textNodes(payload) {
  const nodes = [];
  const push = (obj, key) => {
    if (obj && typeof obj[key] === "string") nodes.push({ obj, key, text: obj[key] });
  };

  if (Array.isArray(payload?.choices)) {
    for (const choice of payload.choices) push(choice?.delta, "content");
  }
  push(payload?.content_block, "text");
  if (payload?.delta && typeof payload.delta === "object") push(payload.delta, "text");
  if (typeof payload?.delta === "string") push(payload, "delta");
  if (Array.isArray(payload?.candidates)) {
    for (const cand of payload.candidates) {
      const parts = cand?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) if (part && typeof part.text === "string") nodes.push({ obj: part, key: "text", text: part.text });
    }
  }
  return nodes;
}

/** Split the first complete SSE event off an accumulated string. Accepts both
 *  LF and CRLF separators; the raw event keeps the separator it arrived with. */
function nextEvent(buffer) {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  let idx = -1;
  let len = 2;
  if (lf !== -1 && (crlf === -1 || lf < crlf)) {
    idx = lf;
    len = 2;
  } else if (crlf !== -1) {
    idx = crlf;
    len = 4;
  }
  if (idx === -1) return null;
  return { event: buffer.slice(0, idx), rest: buffer.slice(idx + len) };
}

function eventData(event) {
  const fields = [];
  for (const line of event.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon) !== "data") continue;
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    fields.push(value);
  }
  return fields.length ? fields.join("\n") : null;
}

function eventPrefix(event) {
  const prefix = [];
  for (const line of event.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith(":")) { prefix.push(line); continue; }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field === "data") continue;
    prefix.push(line);
  }
  return prefix.length ? `${prefix.join("\n")}\n` : "";
}

// Distribute a masked window back across the text nodes that produced it.
// Only the node the change begins in is rewritten, so a replacement is never
// split across two deltas ("[REDACT" / "ED]") — the artefact the mask exists
// to avoid. Text before and after the change maps one-to-one.
function remap(original, masked, spans) {
  const prefix = commonPrefix(original, masked);
  const suffix = commonSuffix(original, masked, prefix);
  const replacement = masked.slice(prefix, masked.length - suffix);
  const tail = original.slice(original.length - suffix);

  const out = new Array(spans.length);
  let pos = 0;
  spans.forEach((size, i) => {
    const end = Math.min(pos + Math.max(size, 0), original.length);
    let piece = original.slice(pos, Math.min(Math.max(prefix, pos), end));
    if (pos <= prefix && prefix <= end) piece += replacement;
    const tailStart = original.length - suffix;
    if (end > tailStart) {
      const from = Math.min(Math.max(pos - tailStart, 0), tail.length);
      const to = Math.min(Math.max(end - tailStart, 0), tail.length);
      piece += tail.slice(from, to);
    }
    out[i] = piece;
    pos = end;
  });
  return out;
}

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a, b, prefix) {
  const limit = Math.min(a.length, b.length);
  let n = 0;
  while (prefix + n < limit && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** The frames that cover the last SCAN_WINDOW_CHARS of text remain held; the
 *  rest has settled and can be released. */
function tailCount(frames) {
  let keep = 0;
  let budget = 0;
  for (let i = frames.length - 1; i >= 0; i--) {
    budget += frames[i].text.length;
    keep++;
    if (budget >= SCAN_WINDOW_CHARS) break;
  }
  return keep;
}

function terminalFrames(format) {
  if (format === FORMATS.OPENAI_RESPONSES || format === FORMATS.OPENAI_RESPONSE) {
    return buildAbortedResponsesTerminalBytes();
  }
  return buildStreamErrorBytes(BLOCK_STATUS, BLOCKED_OUTBOUND, format);
}

/**
 * Wrap a client-format SSE stream in the outbound tap.
 *
 * The tap sits after translation on purpose: the bytes the client reads are
 * the ones judged, in the format the client speaks. Each event is decoded, its
 * text nodes are appended to a sliding window, and only frames whose text can
 * no longer change are released. A value split across deltas is therefore
 * caught as one value, masked once.
 *
 * A block ends the stream with the format's own terminal frames. An
 * unterminated stream reads as a hung request to strict clients; a policy that
 * blocks must end the turn as deliberately as the gateway ends every other.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {{guardrail: object, format: string, provider?: string, model?: string,
 *          connectionId?: string, onBlock?: Function}} opts
 * @returns {ReadableStream<Uint8Array>}
 */
export function guardOutboundStream(stream, { guardrail, format, provider, model, connectionId, onBlock }) {
  if (!guardrail?.engine?.enabled?.()) return stream;

  const engine = guardrail.engine;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let held = [];
  let blocked = false;

  const emit = (controller, chunk) => {
    if (!chunk) return;
    controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
  };

  const release = (controller, final) => {
    if (!held.length) return;
    const keep = final ? 0 : Math.min(tailCount(held), held.length);
    const window = keep === held.length ? [] : held.slice(0, held.length - keep);
    if (!window.length) return;
    held = held.slice(held.length - keep);

    const parts = window.flatMap((f) => f.nodes);
    const original = parts.map((p) => p.text).join("");
    const decision = engine.scan(original);

    if (decision.findings?.length) {
      auditDecision({
        guardrail, decision: { ...decision, action: decision.action },
        direction: "outbound", provider, model, connectionId,
      });
    }

    if (decision.mutated === null || decision.mutated === undefined) {
      for (const frame of window) emit(controller, frame.raw);
      return;
    }

    const spans = parts.map((p) => p.text.length);
    const rewritten = remap(original, decision.mutated, spans);
    let cursor = 0;
    for (const frame of window) {
      if (!frame.nodes.length) { emit(controller, frame.raw); continue; }
      const frameSpans = frame.nodes.map((p) => {
        const text = rewritten[cursor++];
        return text;
      });
      const touched = frame.nodes.some((p, i) => frameSpans[i] !== p.text);
      if (!touched) { emit(controller, frame.raw); continue; }
      frame.nodes.forEach((p, i) => { p.obj[p.key] = frameSpans[i]; });
      emit(controller, `${frame.prefix}data: ${JSON.stringify(frame.payload)}\n\n`);
    }
  };

  const handleEvent = (controller, raw) => {
    const data = eventData(raw);
    let payload = null;
    let nodes = [];
    if (data !== null && data !== "[DONE]") {
      try {
        const decoded = JSON.parse(data);
        if (decoded && typeof decoded === "object") {
          payload = decoded;
          nodes = textNodes(decoded);
        }
      } catch {
        payload = null;
      }
    }
    const text = nodes.map((n) => n.text).join("");

    const pending = { raw: `${raw}\n\n`, prefix: eventPrefix(raw), payload, nodes, text };

    // THE WINDOW includes THIS frame. release() has always judged `held +
    // frame` (it appends to the window before scanning), but the per-frame
    // check here once scanned only `held + text` — so a detector match that
    // sat entirely inside the held tail was released by release() WITHOUT
    // EVER BEING JUDGED, and reached the client ahead of a later block's
    // terminal frames. Judging the whole window first closes that gap: a frame
    // is never released before the window containing it has been scanned.
    //
    // Extra held text is NOT re-released. Re-appending `held` here (the naive
    // "world" list) would leak the held tail to the client a second time on a
    // clean stream — the pre-existing release path owns ordering. Only THIS
    // frame is judged again; its scan is idempotent (the engine reads text,
    // never mutates it), so an entity already flagged in `held` simply trips
    // the block here, which discards `held` anyway.
    const windowText = held.map((f) => f.text).join("") + text;
    if (windowText) {
      const verdict = engine.scan(windowText);
      if (verdict.action === "block" && verdict.findings?.length) {
        auditDecision({ guardrail, decision: verdict, direction: "outbound", provider, model, connectionId });
        const wasBlocked = blocked;
        blocked = true;
        held = [];
        emit(controller, terminalFrames(format));
        // The turn is over — CLOSE the tap after the terminal frames. The
        // upstream parse loop may keep reading (the source may never signal
        // done promptly), and a tap that stays open holds flush() — the point
        // where pending audit writes settle — for a turn already decided.
        // Terminating here ends the tap cleanly right after the block.
        if (!wasBlocked) { try { controller.terminate(); } catch { /* already closed */ } }
        try { onBlock?.({ provider, model, connectionId, count: verdict.findings.length }); } catch { /* never break the stream */ }
        return;
      }
    }

    held.push(pending);
    release(controller, false);
  };

  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      if (blocked) return;
      buffer += decoder.decode(chunk, { stream: true });
      for (;;) {
        const next = nextEvent(buffer);
        if (!next) break;
        buffer = next.rest;
        handleEvent(controller, next.event);
        if (blocked) return;
      }
    },
    flush(controller) {
      if (blocked) return;
      buffer += decoder.decode();
      if (buffer.trim()) handleEvent(controller, buffer.replace(/\r?\n\r?\n$/, ""));
      buffer = "";
      release(controller, true);
    },
  }));
}

export const __test__ = {
  textNodes,
  nextEvent,
  eventData,
  eventPrefix,
  remap,
  commonPrefix,
  commonSuffix,
  tailCount,
  terminalFrames,
  invalidateSwitchCache,
  SCAN_WINDOW_CHARS,
};
