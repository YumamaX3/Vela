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

import { resolvePolicy, logDecision, listEnabledPolicies } from "./policyStore.js";
import { metrics } from "../metrics.js";
import { engineFromPolicy } from "open-sse/guardrails/engine.js";
import { getSettings } from "../db/repos/settingsRepo.js";
import { resolveKey } from "../db/repos/apiKeysRepo.js";
import { buildStreamErrorBytes } from "open-sse/utils/streamHelpers.js";
import { buildAbortedResponsesTerminalBytes } from "open-sse/utils/responsesStreamHelpers.js";
import { FORMATS } from "open-sse/transformer/translator/formats.js";

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

  const policy = await resolvePolicy({ provider, model, chain, apiKeyId, direction });
  if (!policy) return null;
  const engine = engineFromPolicy(policy);
  if (!engine.enabled()) return null;
  return { engine, policy };
}

// ── Audit ───────────────────────────────────────────────────────────────────

/**
 * Record what a guardrail decided. Never blocks, never throws: the decision
 * already happened, and an audit table that fails must not turn a filter into
 * a client error.
 */
export function auditDecision({ guardrail, decision, direction, provider, model, connectionId, excerpt = null }) {
  if (!guardrail || !decision || !decision.findings?.length) return;
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

    if (text) {
      const windowText = held.map((f) => f.text).join("") + text;
      const verdict = engine.scan(windowText);
      if (verdict.action === "block" && verdict.findings?.length) {
        auditDecision({ guardrail, decision: verdict, direction: "outbound", provider, model, connectionId });
        blocked = true;
        held = [];
        emit(controller, terminalFrames(format));
        try { onBlock?.({ provider, model, connectionId, count: verdict.findings.length }); } catch { /* never break the stream */ }
        return;
      }
    }

    held.push({
      raw: `${raw}\n\n`,
      prefix: eventPrefix(raw),
      payload,
      nodes,
      text,
    });
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
