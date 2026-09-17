import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";

// ── The 2026-09-17 free-tier gate ──────────────────────────────────────────
// Zen fingerprints the caller before it serves a token, and both lanes are
// gated (the keyless "public" one and a keyed connection alike):
//   • User-Agent must be `opencode/<version>` with version >= 1.17.0 — a bare
//     "opencode" or a third-party UA draws 403 FreeTierError, and anything
//     below 1.17.0 draws 426 Upgrade Required.
//   • `x-opencode-session` must wear OpenCode's canonical identifier shape —
//     `ses_` + 12 hex + 14 Base62 (30 chars), with `msg_` as its request twin.
//     A UUID-shaped id is refused outright.
// So the wire identity is built here rather than inherited from the caller.
const OPENCODE_UA = "opencode/1.18.31";
const MESSAGES_MODELS = new Set();

export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
export const OPENCODE_REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MAX_SESSION_LENGTH = 256;
const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_opencodeSession";

// Pass a downstream opencode version through only when the gate would accept it.
function hasValidOpencodeVersion(ua) {
  const m = String(ua || "").match(/opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 1 || (major === 1 && minor >= 17);
}

// 12 hex chars of a big-endian 48-bit value — the time half of a canonical id.
function timeHex(value) {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += Number((value >> BigInt(40 - 8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

function base62(bytes) {
  let out = "";
  for (const byte of bytes) out += BASE62_CHARS[byte % 62];
  return out;
}

let lastTimestamp = 0;
let counter = 0;

export function generateSessionId(timestamp = Date.now()) {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp;
    counter = 0;
  }
  counter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter);
  return `ses_${timeHex(~current)}${base62(crypto.randomBytes(14))}`;
}

export function generateRequestId(timestamp = Date.now()) {
  const current = BigInt(timestamp) * 0x1000n + 1n;
  return `msg_${timeHex(current)}${base62(crypto.randomBytes(14))}`;
}

// Deterministic by design: the same conversation always lands on the same
// canonical id, so upstream prompt caching and session affinity survive the
// translation instead of being reset on every turn.
export function translateSessionId(sessionId, clientTool = "") {
  if (typeof sessionId === "string" && OPENCODE_SESSION_RE.test(sessionId.trim())) {
    return sessionId.trim();
  }
  const digest = crypto
    .createHash("sha256")
    .update(`opencode\0${clientTool || "generic"}\0${sessionId || ""}`)
    .digest();
  return `ses_${digest.subarray(0, 6).toString("hex")}${base62(digest.subarray(6, 20))}`;
}

function normalizeSession(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

// Raw client headers arrive lowercase-mapped; accept either case regardless.
function sessionHeader(headers) {
  if (!headers || typeof headers !== "object") return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === SESSION_HEADER) return normalizeSession(value);
  }
  return null;
}

// Salt for the translation — the downstream tool family, stable per client.
function clientToolOf(headers) {
  const ua = String(headers?.["user-agent"] ?? headers?.["User-Agent"] ?? "");
  return ua.split(/[/\s]/)[0].toLowerCase() || "generic";
}

function resolveOpencodeSession(body, credentials, headers) {
  const native = sessionHeader(headers);
  if (native && OPENCODE_SESSION_RE.test(native)) return native;

  const resolved = native || resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode",
  });

  return resolved ? translateSessionId(resolved, clientToolOf(headers)) : generateSessionId();
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  // Request-local: the session rides this call's credentials, never instance
  // state — two concurrent turns can no longer overwrite each other's session.
  prepareRequestCredentials({ body, credentials } = {}) {
    const source = credentials || {};
    return {
      ...source,
      [SESSION_FIELD]: resolveOpencodeSession(body, source, source.rawHeaders || {}),
    };
  }

  transformRequest(model, body, stream, credentials) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  async execute(args) {
    return super.execute({ ...args, credentials: this.prepareRequestCredentials(args) });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

    const downstreamUa = lower["user-agent"] || "";
    const isOpencodeDownstream = hasValidOpencodeVersion(downstreamUa);

    // Hybrid lane: a connection holding an OpenCode API key (apikey connection)
    // rides authenticated Zen — lifted limits, paid models. The virtual
    // keyless connection (accessToken "public", injected by auth.js when no
    // apikey connection exists) keeps the free zen lane open.
    const key = credentials?.apiKey || credentials?.accessToken;
    const hasKey = typeof key === "string" && key && key !== "public";

    const session = credentials?.[SESSION_FIELD]
      || this.prepareRequestCredentials({ credentials })[SESSION_FIELD];

    return {
      "Content-Type": "application/json",
      "Authorization": hasKey ? `Bearer ${key}` : "Bearer public",
      "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": lower["x-opencode-client"] || "desktop",
      "x-opencode-session": session,
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      "x-opencode-project": lower["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*",
    };
  }
}
