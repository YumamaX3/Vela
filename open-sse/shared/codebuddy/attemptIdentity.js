// The CodeBuddy attempt-identity law — every dial carries who is asking, which
// conversation it belongs to, and which attempt of that conversation it is.
//
// Ported from the reference gateway (codebuddy2api v1.5.4):
//   app/request_context.py  — build_attempt_headers, session_conversation_id,
//                             _stable_uuid7, _digest (canonical-JSON sha256)
//   app/client_profiles.py  — SDK_HEADERS (the CLI's own SDK fingerprint)
//   converter.py:501-530    — session_key (sha256 of system + first user message)
//
// Two clocks tick at different rates, and the wire needs both:
//   * PER-ATTEMPT — X-Request-ID / X-Conversation-Message-ID / X-Trace-ID and the
//     b3/traceparent triple are regenerated on EVERY call, exactly as upstream's
//     RequestContext.start_attempt() mints fresh ids per try (request_context.py:186-197).
//   * CONVERSATION-STABLE — X-Conversation-ID (and cn-work's session trio) derive from
//     the (profile, account, sessionKey) triple, so retries of one conversation replay
//     the same identity while each attempt still carries its own trace.
//
// The digest is canonical JSON over an array (sort_keys, tight separators) —
// request_context.py:38-43. Do not swap in a looser serialization: a changed digest
// changes every conversation id the wire has ever carried.

import crypto from "node:crypto";

/** Where the UUIDv7-shaped timestamp is anchored (ms) — request_context.py:73. */
const UUID_TIME_ANCHOR_MS = 1767225600000;
/** The window the derived timestamp may wander within (24*30 days) — request_context.py:74. */
const UUID_TIME_WINDOW_MS = 24 * 30 * 24 * 60 * 60 * 1000;

const WORKBUDDY_PROFILES = new Set(["cn-work", "intl-work"]);
const CLI_PROFILES = new Set(["cn-cli", "intl-cli"]);

/** Canonical-JSON sha256 over one value (array or string) — request_context.py:38-43. */
function canonicalDigest(value) {
  const digest = crypto.createHash("sha256");
  const parts = [];
  canonicalWalk(value, parts);
  for (const part of parts) digest.update(part, "utf8");
  return digest.digest("hex");
}

/** Emit the value as Python's json.JSONEncoder(ensure_ascii=False, sort_keys=True,
 *  separators=(",",":"), allow_nan=False) would, in order. */
function canonicalWalk(value, out) {
  if (value === null || typeof value === "boolean") {
    out.push(value === null ? "null" : value ? "true" : "false");
  } else if (typeof value === "number") {
    out.push(Number.isFinite(value) ? String(value) : "null");
  } else if (typeof value === "string") {
    out.push(JSON.stringify(value));
  } else if (Array.isArray(value)) {
    out.push("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(",");
      canonicalWalk(value[i], out);
    }
    out.push("]");
  } else if (typeof value === "object") {
    out.push("{");
    const keys = Object.keys(value).sort();
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) out.push(",");
      out.push(JSON.stringify(keys[i]), ":");
      canonicalWalk(value[keys[i]], out);
    }
    out.push("}");
  } else {
    out.push("null");
  }
}

/** _msg_text — one message's text content (converter.py:501-509). */
function msgText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

/**
 * The session key from system instructions and the first user message —
 * converter.py:510-530. Reads OpenAI `messages` with a Responses-API `input`
 * fallback (string or block list). Null when neither system nor user text exists.
 *
 * @param {object} payload - the request body (messages or input)
 * @returns {string|null} 32 hex chars, or null
 */
export function sessionKey(payload) {
  if (!payload || typeof payload !== "object") return null;
  let messages = payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    const input = payload.input;
    if (typeof input === "string") messages = [{ role: "user", content: input }];
    else if (Array.isArray(input)) messages = input;
  }
  if (!Array.isArray(messages)) return null;

  let system = "";
  for (const message of messages) {
    if (message && (message.role === "system" || message.role === "developer")) {
      system += msgText(message);
    } else {
      break;
    }
  }
  const firstUserBlock = messages.find((m) => m && m.role === "user");
  const firstUser = firstUserBlock ? msgText(firstUserBlock) : "";
  if (!system && !firstUser) return null;
  return canonicalDigest([system + "\x00" + firstUser]).slice(0, 32);
}

/** _stable_uuid7 — timestamp-anchored UUIDv7 shape over the digest — request_context.py:81-88. */
function stableUuid7(parts) {
  const raw = Buffer.from(canonicalDigest(parts).slice(0, 32), "hex");
  const timestamp = BigInt(UUID_TIME_ANCHOR_MS) + (raw.readBigUInt64BE(0) % BigInt(UUID_TIME_WINDOW_MS));
  // First 6 bytes carry the anchor-extended timestamp (Python writes raw[:6] big-endian).
  for (let i = 0; i < 6; i++) raw[i] = Number((timestamp >> BigInt(8 * (5 - i))) & 0xffn);
  raw[6] = (raw[6] & 0x0f) | 0x70; // version 7
  raw[8] = (raw[8] & 0x3f) | 0x80; // RFC variant
  const hex = raw.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** _uuid_text — dashed UUID form when a 32-hex string is given, else the value as-is. */
function uuidText(value) {
  if (typeof value === "string" && value.length === 32) {
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  return String(value);
}

/**
 * The conversation id for one conversation — request_context.py:91-93.
 * Stable for the same (profile, account, sessionKey) triple.
 *
 * @param {string} profile    one of cn-cli | cn-work | intl-cli | intl-work
 * @param {string} account    the credential identity ("" when unknown)
 * @param {string} sessionKey the session key ("" when unknown — callers pass a random hex
 *                            upstream, converter.py:636)
 * @returns {string} dashed UUID
 */
export function conversationId(profile, account, sessionKey) {
  const parts = [profile, account, sessionKey];
  if (profile === "cn-work") return stableUuid7(parts);
  const hex = canonicalDigest(parts).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The SDK fingerprint block the CLI itself sends — client_profiles.py:19-32. */
export const SDK_HEADERS = Object.freeze({
  "x-stainless-arch": "x64",
  "x-stainless-lang": "js",
  "x-stainless-os": "Linux",
  "x-stainless-package-version": "6.25.0",
  "x-stainless-retry-count": "0",
  "x-stainless-runtime": "node",
  "x-stainless-runtime-version": "v24.21.0",
  "X-Agent-Intent": "craft",
  "X-Agent-Purpose": "conversation",
  "X-Agent-Type": "main",
  "X-Private-Data": "false",
  "X-CodeBuddy-Request": "1",
});

/**
 * Build one attempt's identity headers on top of the base transport headers —
 * request_context.py:96-122. Returns a NEW object; the input is never mutated.
 *
 * Per-attempt fields (message/request/trace ids, spans) are minted fresh on every
 * call; conversation fields are derived from the stable triple.
 *
 * @param {Record<string,string>} baseHeaders - the transport headers already built
 * @param {string} profile - one of cn-cli | cn-work | intl-cli | intl-work
 * @param {object} ids
 * @param {string} ids.conversationId - the stable conversation id (X-Conversation-ID)
 * @param {string} [ids.requestId]    - the request-scoped root (upstream: context.request_id)
 * @param {string} [ids.rootSpan]     - the root span (upstream: context._root_span)
 * @returns {Record<string,string>}
 */
export function attemptHeaders(baseHeaders, profile, { conversationId: conv, requestId, rootSpan } = {}) {
  const root = crypto.randomBytes(16).toString("hex");
  const messageId = crypto.randomBytes(16).toString("hex");
  const reqId = crypto.randomBytes(16).toString("hex");
  const span = crypto.randomBytes(8).toString("hex");
  const parent = (rootSpan || crypto.randomBytes(8).toString("hex"));
  // Upstream reassigns the trace BEFORE building the outgoing dict
  // (request_context.py:102): the CLI lanes trace from the root; the WorkBuddy
  // lanes trace from a fresh random id. Every trace field below derives from the
  // FINAL trace, so no field ever carries an orphaned id.
  const traceId = CLI_PROFILES.has(profile) ? root : crypto.randomBytes(16).toString("hex");

  const outgoing = {
    ...baseHeaders,
    ...SDK_HEADERS,
    "X-Conversation-ID": conv,
    "X-Conversation-Request-ID": root,
    "X-Root-Request-ID": root,
    "X-Conversation-Message-ID": messageId,
    "X-Request-ID": reqId,
    "X-Trace-ID": traceId,
    traceparent: `00-${traceId}-${span}-01`,
    b3: `${traceId}-${span}-1-${parent}`,
    "X-B3-TraceId": traceId,
    "X-B3-SpanId": span,
    "X-B3-ParentSpanId": parent,
    "X-B3-Sampled": "1",
  };

  if (WORKBUDDY_PROFILES.has(profile)) {
    outgoing["X-Agent-Runtime"] = "local-agent";
    // The WorkBuddy lanes read message/request ids in dashed UUID form
    // (request_context.py:99-100).
    outgoing["X-Conversation-Message-ID"] = uuidText(messageId);
    outgoing["X-Request-ID"] = uuidText(reqId);
  } else if (CLI_PROFILES.has(profile)) {
    outgoing["X-Agent-Runtime"] = "other";
    // The CLI lanes copy message→request and root→trace (request_context.py:101-102).
    outgoing["X-Request-ID"] = messageId;
  }

  if (profile === "cn-work") {
    outgoing["X-Session-ID"] = conv;
    outgoing["X-Root-Request-ID"] = stableUuid7(["root", conv]).replace(/-/g, "");
    outgoing["acp-connection-id"] = stableUuid7(["acp", conv]);
    outgoing["baggage"] =
      `buddyId=,buddyName=,codebuddy.session_id=${conv},` +
      `codebuddy.conversation_request_id=${root},x-agent-runtime=local-agent,` +
      `x-agent-intent=${outgoing["X-Agent-Intent"] || "craft"}`;
  }

  return outgoing;
}

/** Test hooks — parity vectors for the vitest battery. */
export const __test__ = { canonicalDigest, stableUuid7, uuidText, msgText };
