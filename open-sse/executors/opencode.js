import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { initState } from "../translator/index.js";
import { parseSSELine, formatSSE } from "../utils/streamHelpers.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

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
// The full client fingerprint, not the bare version. Upstream #4105/#4111 wants
// a UA shaped like the shipped binary; the ai-sdk/runtime suffix is what the
// current OpenCode build emits, so a bare "opencode/1.18.31" no longer matches
// the client the gate is looking for (it still clears the 1.17.0 floor).
const OPENCODE_UA = "opencode/1.18.31 ai-sdk/provider-utils/4.0.46 runtime/bun/1.3.14";
const MESSAGES_MODELS = new Set();
// Models the Responses API alone serves. A chat/completions call for these
// answers 500 upstream (#3819/#3820, v0.5.75) — /responses is the only lane.
const RESPONSES_MODELS_EXACT = new Set(["grok-4.6", "gpt-5.6-luna"]);
// The file-search quartet the free-tier gate fingerprints by CASE. Claude Code
// CLI declares them capitalised (Bash/Glob/Grep/Read); the gate looks for the
// lowercase spelling and answers 403 FreeTierError when it cannot find it.
// Measured upstream 2026-09-18: capitalised → 403, lowercase → 200, both → 500.
const FINGERPRINT_TOOLS = new Set(["bash", "glob", "grep", "read"]);

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
// A canonical 40-char hex project id (PR #4111). The literal "global" that the
// older code sent is no longer a shape the gate accepts; it must look like a
// per-project identifier. A raw client value still wins when it is not the
// placeholder — see buildHeaders.
export function generateProjectId() {
  return crypto.randomBytes(20).toString("hex");
}
// Does this model live on the Responses API alone? Accepts a bare id or an
// "alias/model" pair, and ignores a "(variant)" suffix the CLIs append.
export function isOpencodeResponsesModel(model) {
  const base = String(model || "").split("(")[0].split("/").pop().trim();
  return base.includes("muse-spark") || RESPONSES_MODELS_EXACT.has(base);
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
    const credentials = this.prepareRequestCredentials(args);
    if (isOpencodeResponsesModel(args.model)) {
      return this.executeWithResponsesEndpoint({ ...args, credentials });
    }
    return super.execute({ ...args, credentials });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    if (isOpencodeResponsesModel(model)) return `${base}/zen/v1/responses`;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }
  // Rename the capitalised file-search quartet to the lowercase spelling the
  // free-tier gate fingerprints on, and hand back the map so the client still
  // receives the name it declared. Renamed, never duplicated: appending a
  // lowercase twin beside the caller's "Bash" yields two tools of one name and
  // turns the 403 into a 500. The shapes differ by lane — Chat Completions
  // nests the name under `function`, the Responses API puts it at top level.
  concealFingerprintTools(body) {
    if (!body || !Array.isArray(body.tools)) return { body, toolNameMap: null };
    const toolNameMap = new Map();
    const canonical = (name) => {
      if (typeof name !== "string") return null;
      const lower = name.toLowerCase();
      if (!FINGERPRINT_TOOLS.has(lower) || name === lower) return null;
      toolNameMap.set(lower, name);
      return lower;
    };
    const tools = body.tools.map((tool) => {
      if (!tool || typeof tool !== "object") return tool;
      const topLevel = canonical(tool.name);
      if (topLevel) return { ...tool, name: topLevel };
      const nested = canonical(tool.function?.name);
      if (nested) return { ...tool, function: { ...tool.function, name: nested } };
      return tool;
    });
    if (!toolNameMap.size) return { body, toolNameMap: null };
    return { body: { ...body, tools }, toolNameMap };
  }
  // Restore the client's own spelling on an outgoing OpenAI-shaped chunk. Applied
  // here rather than downstream because Vela only decloaks in the same-format
  // branch of translateResponse; a Claude client on this lane converts
  // openai→claude afterwards, where the map would no longer be consulted.
  static restoreChunkToolNames(chunk, toolNameMap) {
    if (!toolNameMap?.size || !chunk?.choices) return chunk;
    let touched = false;
    const choices = chunk.choices.map((choice) => {
      const calls = choice?.delta?.tool_calls;
      if (!Array.isArray(calls)) return choice;
      const restored = calls.map((call) => {
        const name = call?.function?.name;
        if (typeof name !== "string" || !toolNameMap.has(name)) return call;
        touched = true;
        return { ...call, function: { ...call.function, name: toolNameMap.get(name) } };
      });
      return { ...choice, delta: { ...choice.delta, tool_calls: restored } };
    });
    return touched ? { ...chunk, choices } : chunk;
  }
  // muse-spark / grok-4.6 / gpt-5.6-luna live on the Responses API alone — a
  // chat/completions call for them answers 500 upstream (#3819/#3820, v0.5.75).
  // Vela already carries both translation directions, so the body is converted
  // on the way out and the SSE stream back on the way in, exactly as the GitHub
  // executor does for Copilot's /responses lane.
  async executeWithResponsesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl(model);
    const headers = this.buildHeaders(credentials, stream);
    const converted = openaiToOpenAIResponsesRequest(model, body, true, credentials);
    const { body: transformedBody, toolNameMap } = this.concealFingerprintTools(converted);
    log?.debug?.("OPENCODE", `Responses lane for ${model}`);
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    }, proxyOptions);
    const result = { response, url, headers, transformedBody };
    if (!response.ok) return result;
    const state = initState("openai-responses");
    state.model = model;
    if (!response.body) {
      return { ...result, response: new Response("", { status: response.status, headers: response.headers }) };
    }
    const decoder = new TextDecoder();
    let buffer = "";
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = parseSSELine(trimmed);
          if (!parsed) continue;
          if (parsed.done && stream === true) {
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            continue;
          }
          const outChunk = openaiResponsesToOpenAIResponse(parsed, state);
          if (outChunk) {
            const restored = OpenCodeExecutor.restoreChunkToolNames(outChunk, toolNameMap);
            controller.enqueue(new TextEncoder().encode(formatSSE(restored, "openai")));
          }
        }
      },
      flush(controller) {
        const tail = openaiResponsesToOpenAIResponse(null, state);
        if (tail) controller.enqueue(new TextEncoder().encode(formatSSE(tail, "openai")));
      },
    });
    return {
      ...result,
      response: new Response(response.body.pipeThrough(transformStream), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    };
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
      "Authorization": `Bearer ${hasKey ? key : "public"}`,
      "x-api-key": hasKey ? key : "public",
      "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": lower["x-opencode-client"] || "desktop",
      "x-opencode-session": session,
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      // The old literal "global" is the very shape the gate stopped accepting;
      // a real client value still passes through, everything else gets a
      // fresh canonical 40-char hex id (PR #4111).
      "x-opencode-project": (() => {
        const supplied = String(lower["x-opencode-project"] || "").trim();
        return supplied && supplied !== "global" ? supplied : generateProjectId();
      })(),
      "Accept": stream ? "text/event-stream" : "*/*",
    };
  }
}
