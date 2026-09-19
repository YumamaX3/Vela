import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
} from "../translator/formats/responsesApi.js";
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
// Union Alpha is served by /zen/v1/messages (Anthropic Messages API) alone —
// see open-sse/providers/registry/opencode.js (targetFormat: "claude").
const MESSAGES_MODELS = new Set(["union-alpha"]);
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
const MAX_TOOL_NAME_LEN = 128;
const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_opencodeSession";
const REQ_FIELD = "_opencodeRequest";

// The free-tier gate fingerprints the caller by tool name. On the Chat lane a
// missing declaration is satisfied by appending the lowercase decoys — the
// caller's own spelling stays in place beside them (upstream v0.5.81). The
// Responses lane is served by concealFingerprintTools instead, which renames
// rather than duplicates (a twin there turns the 403 into a 500).
const OPENCODE_DECOY_CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function cloakChatTools(body) {
  if (!body || typeof body !== "object") return;
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  if (!hasTools) {
    body.tools = OPENCODE_DECOY_CHAT_TOOLS.map((t) => ({ ...t, function: { ...t.function } }));
    if (!body.tool_choice) body.tool_choice = "none";
    return;
  }
  const names = new Set(body.tools.map((t) => t?.function?.name || t?.name));
  for (const tool of OPENCODE_DECOY_CHAT_TOOLS) {
    if (!names.has(tool.function.name)) body.tools.push({ ...tool, function: { ...tool.function } });
  }
}

// Upstream accounts the free-tier quota per session: minting a fresh
// x-opencode-session on every request burns through it and surfaces as 429
// FreeUsageLimitError with growing reset-after delays, while the real CLI
// reuses one long-lived canonical session per conversation. Mirror that — one
// stable canonical session per downstream identity, evicted after
// MEMORY_CONFIG.sessionTtlMs like the other session stores.
const stableOpencodeSessions = new Map();
const MAX_STABLE_SESSIONS = 1000;
const stableSessionCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of stableOpencodeSessions) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) stableOpencodeSessions.delete(key);
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (stableSessionCleanup.unref) stableSessionCleanup.unref();

function identityKey(credentials) {
  const connectionId = credentials?.connectionId || credentials?.id;
  if (connectionId) return `opencode:conn:${String(connectionId).slice(0, 128)}`;
  const raw = credentials?.rawHeaders || {};
  const auth = raw.authorization || raw.Authorization || raw["x-api-key"] || raw["X-Api-Key"] || "";
  if (auth) {
    const digest = crypto.createHash("sha256").update(String(auth)).digest("hex").slice(0, 32);
    return `opencode:auth:${digest}`;
  }
  return "opencode:default";
}

export function stableSessionId(credentials) {
  const key = identityKey(credentials);
  const existing = stableOpencodeSessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    stableOpencodeSessions.delete(key);
    stableOpencodeSessions.set(key, existing);
    return existing.sessionId;
  }
  const sessionId = generateSessionId();
  if (stableOpencodeSessions.size >= MAX_STABLE_SESSIONS) {
    stableOpencodeSessions.delete(stableOpencodeSessions.keys().next().value);
  }
  stableOpencodeSessions.set(key, { sessionId, lastUsed: Date.now() });
  return sessionId;
}

function normalizeRequestId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return OPENCODE_REQUEST_RE.test(normalized) ? normalized : null;
}

// Does the body itself carry a conversation identity? Only then may the session
// manager be consulted for one — otherwise the stable per-identity session is
// what keeps a retry on the gate's good side (upstream v0.5.81).
function bodyHasSessionHints(body) {
  try {
    if (!body || typeof body !== "object") return false;
    if (typeof body.session_id === "string" && body.session_id.trim()) return true;
    if (typeof body.conversation_id === "string" && body.conversation_id.trim()) return true;
    if (typeof body.prompt_cache_key === "string" && body.prompt_cache_key.trim()) return true;
    if (body.metadata && typeof body.metadata.user_id === "string" && body.metadata.user_id.trim()) return true;
    if (body.request && body.request.sessionId != null && String(body.request.sessionId) !== "") return true;
    const arr = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : null;
    if (arr) {
      let assistantText = "";
      for (const msg of arr) {
        if (msg?.role !== "assistant") continue;
        const content = msg.content;
        if (typeof content === "string") assistantText += content;
        else if (Array.isArray(content)) {
          for (const part of content) assistantText += part?.text || part?.output || "";
        }
        if (assistantText.length >= 50) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

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
// The last user-visible turn of text, used to key a request id on the *turn*
// rather than on the moment (ported from upstream 9router v0.5.81).
function lastUserText(body) {
  try {
    if (!body || typeof body !== "object") return "";
    const arr = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : null;
    if (!arr) return typeof body.input === "string" ? body.input.slice(-600) : "";
    for (let i = arr.length - 1; i >= 0; i--) {
      const msg = arr[i];
      if (!msg) continue;
      if (msg.role && msg.role !== "user") continue;
      const content = msg.content;
      if (typeof content === "string" && content.trim()) return content.trim().slice(-600);
      if (Array.isArray(content)) {
        const text = content
          .map((part) => (typeof part === "string" ? part : part?.text || part?.input_text || ""))
          .join(" ")
          .trim();
        if (text) return text.slice(-600);
      }
    }
  } catch {
    return "";
  }
  return "";
}

// The real CLI sends the current user message id (stable per turn, same on
// retries) as x-opencode-request. Deriving it deterministically from the
// session plus the last user message lets a retry share the id the gate
// already accepted instead of asking for a new one (upstream 9router v0.5.81 —
// "reuse one stable upstream identity to stop 429s").
export function deriveRequestId(sessionId, body) {
  const text = lastUserText(body);
  if (!text) return generateRequestId();
  const digest = crypto.createHash("sha256").update(`opencode-req\0${sessionId || ""}\0${text}`).digest();
  const secondsHex = digest.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[digest[i] % 62];
  const id = `msg_${secondsHex}${randomPart}`;
  return OPENCODE_REQUEST_RE.test(id) ? id : generateRequestId();
}
// A canonical 40-char hex project id (PR #4111). The literal "global" that the
// older code sent is no longer a shape the gate accepts; it must look like a
// per-project identifier. A raw client value still wins when it is not the
// placeholder — see buildHeaders.
export function generateProjectId() {
  return crypto.randomBytes(20).toString("hex");
}
// Strip the thinking suffix "model(level)" so registry lookups hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
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

function resolveOpencodeSession(body, credentials, providerSessionId, clientTool) {
  const headers = credentials?.rawHeaders || {};
  const native = sessionHeader(headers);
  if (native && OPENCODE_SESSION_RE.test(native)) return native;

  const hinted = native || normalizeSession(providerSessionId);
  if (hinted) return translateSessionId(hinted, clientTool);

  if (credentials?.connectionId || bodyHasSessionHints(body)) {
    let viaManager = null;
    try {
      viaManager = resolveSessionId({
        headers,
        body,
        connectionId: credentials?.connectionId,
        scope: "opencode",
      });
    } catch {
      viaManager = null;
    }
    if (viaManager) return translateSessionId(viaManager, clientTool);
  }

  return stableSessionId(credentials);
}

// A valid downstream x-opencode-request (the CLI's per-turn message id) is
// honored as-is; everything else is derived from the session + last user turn
// so a retry re-sends the id the gate already accepted.
function resolveOpencodeRequestId(body, credentials, sessionId) {
  const raw = credentials?.rawHeaders || {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.toLowerCase() === "x-opencode-request") {
      const normalized = normalizeRequestId(value);
      if (normalized) return normalized;
      break;
    }
  }
  return deriveRequestId(sessionId, body);
}

function normalizeResponsesTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    let parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    if (parameters.type === "object" && !parameters.properties) parameters = { ...parameters, properties: {} };
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, MAX_TOOL_NAME_LEN);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(tool.name);
    return true;
  });
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

function sanitizeResponsesItems(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    // Strip prior-turn reasoning items: OpenCode Free uses public/pooled credentials
    // (`Bearer public`) routing to an upstream OpenAI/Console account pool.
    // OpenAI Responses API strictly enforces that reasoning `encrypted_content`
    // can only be decrypted by the exact caller/account that issued it; sending it
    // across different accounts or rotating proxy relays triggers:
    // [invalid_request_error] reasoning `encrypted_content` was not issued to this caller (400).
    // Furthermore, under stateless mode (store=false), omitting encrypted_content
    // causes OpenAI to reject the referenced reasoning item as "not found or was deleted".
    // Dropping prior reasoning items allows multi-turn conversations and tool-calling
    // loops to succeed cleanly.
    if (item.type === "reasoning") return false;
    delete item.encrypted_content;
    delete item.reasoning_encrypted_content;
    if (item.type === "function_call") {
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") return false;
      item.name = item.name.trim().slice(0, MAX_TOOL_NAME_LEN);
      item.call_id = clampResponsesCallId(item.call_id);
      item.arguments = coerceResponsesArguments(item.arguments);
      return true;
    }
    if (item.type === "function_call_output") {
      item.call_id = clampResponsesCallId(item.call_id);
      item.output = coerceResponsesOutput(item.output);
      return true;
    }
    return true;
  });
}

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : null;
  const requestedEffort = typeof body.reasoning_effort === "string"
    ? body.reasoning_effort
    : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if ((effort === "max" || effort === "ultra") && supportedLevels?.length && !supportedLevels.includes(effort)) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  // Request-local: the session rides this call's credentials, never instance
  // state — two concurrent turns can no longer overwrite each other's session.
  prepareRequestCredentials({ body, credentials, providerSessionId, clientTool } = {}) {
    const source = credentials || {};
    const tool = clientTool || clientToolOf(source.rawHeaders || {});
    const session = resolveOpencodeSession(body, source, providerSessionId, tool);
    return {
      ...source,
      [SESSION_FIELD]: session,
      [REQ_FIELD]: resolveOpencodeRequestId(body, source, session),
    };
  }

  transformRequest(model, body, stream, credentials) {
    if (body && typeof body === "object") {
      // Zen answers a non-streaming free request with 403 FreeTierError; always
      // stream upstream and let the handler layer aggregate for non-stream clients.
      body.stream = true;
      if (isOpencodeResponsesModel(model)) {
        // The free 1.3 lane accepts tool_choice "auto" alone — a named, required
        // or none choice is answered 400 upstream, so it is demoted wherever the
        // registry declares the quirk (upstream v0.5.81).
        const forced = this.config.quirks?.forceAutoToolChoiceModels || [];
        if ("tool_choice" in body && body.tool_choice !== "auto" && forced.includes(baseModelId(model))) {
          body.tool_choice = "auto";
        }
        // Responses API names the output cap max_output_tokens and takes thinking
        // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
        const normalized = normalizeResponsesInput(body.input);
        if (normalized) body.input = normalized;
        if (!Array.isArray(body.input) || body.input.length === 0) {
          body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
        }
        if (body.max_output_tokens === undefined) {
          if (body.max_completion_tokens !== undefined) body.max_output_tokens = body.max_completion_tokens;
          else if (body.max_tokens !== undefined) body.max_output_tokens = body.max_tokens;
        }
        delete body.max_tokens;
        delete body.max_completion_tokens;
        normalizeOpencodeReasoning(model, body);
        // Pooled credentials: a reasoning item issued to one account cannot be
        // replayed by another, and the lane is stateless — strip the prior-turn
        // items rather than ship them upstream (400 not-issued-to-this-caller).
        body.store = false;
        normalizeResponsesTools(body);
        sanitizeResponsesItems(body);
      } else {
        cloakChatTools(body);
      }
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  async execute(args) {
    const credentials = this.prepareRequestCredentials(args);
    if (isOpencodeResponsesModel(args.model)) {
      const body = this.transformRequest(args.model, args.body, args.stream, credentials);
      return this.executeWithResponsesEndpoint({ ...args, body, credentials });
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

  buildHeaders(credentials, stream = true, url = "") {
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

    const session = credentials?.[SESSION_FIELD] || this.prepareRequestCredentials({ credentials })[SESSION_FIELD];
    const downstreamReq = normalizeRequestId(lower["x-opencode-request"]);
    const requestId = credentials?.[REQ_FIELD] || downstreamReq || generateRequestId();

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${hasKey ? key : "public"}`,
      "x-api-key": hasKey ? key : "public",
      "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": lower["x-opencode-client"] || "desktop",
      "x-opencode-session": session,
      "x-opencode-request": requestId,
      // The old literal "global" is the very shape the gate stopped accepting;
      // a real client value still passes through, everything else gets a
      // fresh canonical 40-char hex id (PR #4111).
      "x-opencode-project": (() => {
        const supplied = String(lower["x-opencode-project"] || "").trim();
        return supplied && supplied !== "global" ? supplied : generateProjectId();
      })(),
      "Accept": stream ? "text/event-stream" : "*/*",
    };
    if (url.endsWith("/messages")) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return headers;
  }
}
