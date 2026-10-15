import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OPENCODE_FREE_TIER_MODELS, MUSE_SPARK_FREE_RE } from "../providers/registry/opencode.js";
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
// ── The 2026-10-15 v2 gate (ported from luqman-v1/9router-go v1.9.12) ────────
// OpenCode v2 moved free inference OFF /zen/v1 entirely — every free request
// there now answers 403 FreeTierError. The keyless free lane dials
// /inference/v1 instead, and the gate reads a different identity:
//   • User-Agent must wear the v2 SHAPE `opencode/<channel>/<version>/<client>`
//     (a v1 shape is rejected outright), the shipped form being:
const OPENCODE_V2_UA = "opencode/latest/2.0.29/cli";
//   • `x-opencode-client` becomes "cli", not "desktop"
const OPENCODE_V2_CLIENT = "cli";
//   • one session is mirrored across FOUR headers — a downstream hint must move
//     every mirror together (internal/proxy/opencode.go BuildOpenCodeHeaders)
const SESSION_MIRROR_HEADERS = ["x-opencode-session", "x-opencode-session-id", "x-session-affinity", "x-session-id"];
//   • `x-opencode-request` is REJECTED by the v2 gate and must never be sent
//   • `x-opencode-project` reverts to the literal "global"
const OPENCODE_V2_PROJECT = "global";
// The curated free-tier ids and the Muse Spark free-family pattern are DEFINED
// in the registry (open-sse/providers/registry/opencode.js) so the list has
// exactly one source of truth; the executor consumes them here. Never fork this
// list — a second copy is how a free id ends up on the retired /zen/v1 gate.
// Does this model id travel the v2 gate? Strips a "(variant)" suffix first, the
// same normalization the rest of this executor applies before registry lookups.
export function isOpenCodeFreeTierModel(model) {
  const base = baseModelId(model);
  return OPENCODE_FREE_TIER_MODELS.has(base) || MUSE_SPARK_FREE_RE.test(base);
}
// ── The v2 body fingerprint ────────────────────────────────────────────────
// The v2 gate no longer fingerprints by tool NAME CASE — it wants OpenCode's
// EXACT `read` and `shell` declarations, verbatim descriptions and parameter
// schemas (9router-go internal/translator/opencode_v2_fingerprint.go
// openCodeReadDescription / openCodeShellDescription / openCodeV2Parameters).
// A caller tool reusing one of those names with a DIFFERENT definition travels
// under a `*_client` alias so the exact definition can still be appended —
// checking the pre-alias set would send no fingerprint at all and the gate
// 403s. On the Responses lane the appended tools carry `strict:false`.
const OPENCODE_V2_READ_DESCRIPTION = "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.";
const OPENCODE_V2_SHELL_DESCRIPTION = "Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete. DO NOT poll for completion.";
const OPENCODE_V2_READ_PARAMETERS = {
  additionalProperties: false,
  properties: {
    limit: { description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)", minimum: 0, type: "integer" },
    offset: { description: "The line or directory entry to start reading from (1-based)", minimum: 0, type: "integer" },
    path: { description: "File or directory to read", type: "string" },
  },
  required: ["path"],
  type: "object",
};
const OPENCODE_V2_SHELL_PARAMETERS = {
  additionalProperties: false,
  properties: {
    background: { description: "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.", type: "boolean" },
    command: { description: "Shell command string to execute", type: "string" },
    timeout: { description: "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.", minimum: 0, type: "integer" },
    workdir: { description: "Working directory to execute the command in. Defaults to the current working directory.", type: "string" },
  },
  required: ["command"],
  type: "object",
};
// `flat` is true for the Responses API, false for Chat Completions — the two
// lanes nest the tool differently, exactly as the reference's openCodeV2Tool.
export function openCodeV2Tool(name, flat = false) {
  const description = name === "shell" ? OPENCODE_V2_SHELL_DESCRIPTION : OPENCODE_V2_READ_DESCRIPTION;
  const parameters = name === "shell" ? OPENCODE_V2_SHELL_PARAMETERS : OPENCODE_V2_READ_PARAMETERS;
  if (flat) return { type: "function", name, description, parameters, strict: false };
  return { type: "function", function: { name, description, parameters } };
}
// The placeholder note appended when the fingerprint tools are injected. The
// gate does not read prompt text, but the model does — upstream emits this
// verbatim so a caller's model never tries to call a tool that is only a
// fingerprint (noteUnavailableTools). Never applied to a Claude-shaped body,
// which carries `system` instead of a leading system message.
function openCodeV2Note(appended) {
  const quoted = appended.map((n) => `\`${n}\``).join(" or ");
  return appended.length > 1
    ? `Do not call the ${quoted} tools; they are placeholders that do nothing. Use the other tools you have been given instead.`
    : `Do not call the ${quoted} tool; it is a placeholder that does nothing. Use the other tools you have been given instead.`;
}
// ── The v2 body fingerprint concealer ──────────────────────────────────────
// Ports ConcealOpenCodeV2FingerprintTools (9router-go internal/translator/
// opencode_v2_fingerprint.go). Order matters and mirrors the reference exactly:
//   1. a caller tool named exactly read/shell with a DIFFERENT definition is
//      renamed to `<name>_client` (deduped against collisions) and recorded in
//      the map — history and tool_choice are retargeted to the alias;
//   2. on the Responses lane every caller tool is rebuilt into the canonical
//      flat shape (only type/name/description/parameters survive, nameless
//      entries dropped, a missing schema defaulted) BEFORE the append, so the
//      appended tools keep `strict:false`;
//   3. OpenCode's exact definitions are appended when absent, then the note is
//      injected into `instructions` (Responses) or a leading system message
//      (Chat) — never on a Claude-shaped body carrying `system`.
// Returns the map of sent-name → original name so the response side restores
// the caller's own spelling, exactly as concealFingerprintTools does.
function concealOpenCodeV2Tools(body, flat = false) {
  if (!body || !Array.isArray(body.tools)) return { body, toolNameMap: null };
  const toolNameMap = new Map();
  const nameOf = (tool) => {
    if (!tool || typeof tool !== "object") return "";
    if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
    if (tool.function && typeof tool.function.name === "string") return tool.function.name.trim();
    return "";
  };
  const taken = new Set(body.tools.map(nameOf).filter(Boolean));
  const seen = new Set();
  const kept = [];
  for (const tool of body.tools) {
    const name = nameOf(tool);
    if (name !== "read" && name !== "shell") { kept.push(tool); continue; }
    if (seen.has(name)) continue; // a duplicate name is a 500 upstream, never kept
    seen.add(name);
    if (isExactOpenCodeV2Definition(tool, name)) { kept.push(tool); continue; }
    let alias = `${name}_client`;
    for (let i = 2; taken.has(alias); i++) alias = `${name}_client${i}`;
    taken.add(alias);
    toolNameMap.set(alias, name);
    renameTool(tool, alias);
    kept.push(tool);
  }
  body.tools = kept;
  if (flat) canonicalizeOpenCodeV2ResponsesTools(body);
  else defaultOpenCodeV2ChatToolSchemas(body);
  if (toolNameMap.size > 0) {
    aliasOpenCodeV2History(body, toolNameMap);
    aliasOpenCodeV2Choice(body, toolNameMap);
  }
  if (flat) dropNamelessOpenCodeV2FunctionCalls(body);
  // The presence check runs on POST-alias names, like upstream's
  // appendMissingFingerprintTools: a caller read/shell now travels under its
  // alias, so the exact definition is genuinely absent and still appended.
  const present = new Set(body.tools.map(nameOf));
  const appended = [];
  for (const name of ["read", "shell"]) {
    if (present.has(name)) continue;
    body.tools.push(openCodeV2Tool(name, flat));
    appended.push(name);
  }
  if (flat && body.tool_choice === undefined) body.tool_choice = "auto";
  if (appended.length > 0) {
    const note = openCodeV2Note(appended);
    if (flat) {
      body.instructions = typeof body.instructions === "string" && body.instructions.trim()
        ? `${body.instructions}\n\n${note}`
        : note;
    } else if (!Object.prototype.hasOwnProperty.call(body, "system")) {
      const first = Array.isArray(body.messages) ? body.messages[0] : null;
      if (first && first.role === "system" && typeof first.content === "string") {
        first.content = `${first.content}\n\n${note}`;
      } else {
        body.messages = [{ role: "system", content: note }, ...(Array.isArray(body.messages) ? body.messages : [])];
      }
    }
  }
  return { body, toolNameMap: toolNameMap.size > 0 ? toolNameMap : null };
}
// Verbatim-description check: a tool already carrying OpenCode's exact
// definition is left alone, so a genuine CLI caller is not aliased for nothing.
function isExactOpenCodeV2Definition(tool, name) {
  if (!tool || typeof tool !== "object") return false;
  const def = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : tool;
  const want = name === "shell" ? OPENCODE_V2_SHELL_DESCRIPTION : OPENCODE_V2_READ_DESCRIPTION;
  const params = name === "shell" ? OPENCODE_V2_SHELL_PARAMETERS : OPENCODE_V2_READ_PARAMETERS;
  return def.description === want && JSON.stringify(def.parameters) === JSON.stringify(params);
}
function renameTool(tool, name) {
  if (tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)) {
    tool.function = { ...tool.function, name };
  } else {
    tool.name = name;
  }
}
// Rebuild every Responses-lane tool into the canonical flat shape — the same
// normalization normalizeResponsesTools performs, applied before the append.
function canonicalizeOpenCodeV2ResponsesTools(body) {
  const valid = new Set();
  const out = [];
  for (const tool of body.tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
    let name = typeof tool.name === "string" ? tool.name.trim() : "";
    let description = typeof tool.description === "string" ? tool.description : "";
    if (tool.function && typeof tool.function === "object") {
      if (!name && typeof tool.function.name === "string") name = tool.function.name.trim();
      if (!description && typeof tool.function.description === "string") description = tool.function.description;
    }
    if (!name) continue;
    if (name.length > MAX_TOOL_NAME_LEN) name = name.slice(0, MAX_TOOL_NAME_LEN);
    let parameters = tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
      ? tool.parameters
      : (tool.function?.parameters && typeof tool.function.parameters === "object" && !Array.isArray(tool.function.parameters) ? tool.function.parameters : null);
    if (!parameters) parameters = { type: "object", properties: {} };
    else if (parameters.type === "object" && !parameters.properties) parameters = { ...parameters, properties: {} };
    const entry = { type: "function", name, parameters };
    if (description) entry.description = description;
    valid.add(name);
    out.push(entry);
  }
  body.tools = out;
  return valid;
}
// The chat lane leaves caller tools alone but defaults a missing schema, so no
// stub schema reaches the gate.
function defaultOpenCodeV2ChatToolSchemas(body) {
  for (const tool of body.tools) {
    if (!tool || typeof tool !== "object") continue;
    const hasParams = (t) => t.parameters && typeof t.parameters === "object" && !Array.isArray(t.parameters);
    if (hasParams(tool)) continue;
    if (tool.function && typeof tool.function === "object") {
      tool.function = { ...tool.function, parameters: { type: "object", properties: {} } };
    } else if (typeof tool.name === "string") {
      tool.parameters = { type: "object", properties: {} };
    }
  }
}
// Prior-turn function_call items with no name are rejected by the Responses
// validator; a harness history can carry one.
function dropNamelessOpenCodeV2FunctionCalls(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    if (item.type === "function_call") {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) return false;
    }
    return true;
  });
}
// Retarget the aliased names in conversation history and in an explicit
// tool_choice, so the model sees one consistent name set.
function aliasOpenCodeV2History(body, toolNameMap) {
  const toAlias = new Map([...toolNameMap].map(([alias, original]) => [original, alias]));
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item && typeof item === "object" && item.type === "function_call" && typeof item.name === "string" && toAlias.has(item.name)) {
        item.name = toAlias.get(item.name);
      }
    }
  }
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg || typeof msg !== "object" || !Array.isArray(msg.tool_calls)) continue;
      for (const call of msg.tool_calls) {
        if (call?.function && typeof call.function.name === "string" && toAlias.has(call.function.name)) {
          call.function = { ...call.function, name: toAlias.get(call.function.name) };
        }
      }
    }
  }
}
function aliasOpenCodeV2Choice(body, toolNameMap) {
  const toAlias = new Map([...toolNameMap].map(([alias, original]) => [original, alias]));
  if (!body.tool_choice || typeof body.tool_choice !== "object" || Array.isArray(body.tool_choice)) return;
  if (typeof body.tool_choice.name === "string" && toAlias.has(body.tool_choice.name)) {
    body.tool_choice = { ...body.tool_choice, name: toAlias.get(body.tool_choice.name) };
  }
  if (body.tool_choice.function && typeof body.tool_choice.function.name === "string" && toAlias.has(body.tool_choice.function.name)) {
    body.tool_choice = { ...body.tool_choice, function: { ...body.tool_choice.function, name: toAlias.get(body.tool_choice.function.name) } };
  }
}
// Does this 403 carry the free-tier gate's refusal? The fallback re-dials on
// the v1 lane ONLY for this shape — a 403 that is really an auth or network
// refusal must never be laundered into "the old lane works". Body text is read
// once and the response is cloned so the caller's stream is untouched.
async function isFreeTierErrorResponse(response) {
  if (!response || response.status !== 403) return false;
  try {
    const text = await response.clone().text();
    if (!text) return false;
    return /FreeTierError|free tier can only be used/i.test(text);
  } catch {
    return false;
  }
}
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
// Pinned to 1, deliberately. Upstream decodes the 12-hex session prefix and
// rejects a non-small counter with 403 FreeTierError, so an incrementing
// counter starts failing under concurrent load — the CLI pins it to 1 too
// (9router-go v1.9.12, GenerateOpenCodeSessionID "descendingTimeHex").
let counter = 1;

export function generateSessionId(timestamp = Date.now()) {
  // Counter stays pinned at 1 even within one millisecond: the low bits must
  // remain small. Uniqueness survives on the 14-byte Base62 tail, which stays
  // crypto-random.
  if (timestamp !== lastTimestamp) lastTimestamp = timestamp;
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
        // The v2 gate wants OpenCode's exact read/shell declarations, not the
        // v1 quartet rename — so a free id takes the v2 concealer instead.
        if (isOpenCodeFreeTierModel(model)) {
          const { toolNameMap } = concealOpenCodeV2Tools(body, true);
          if (toolNameMap) body._v2ToolNameMap = toolNameMap;
        }
      } else {
        if (isOpenCodeFreeTierModel(model)) {
          const { toolNameMap } = concealOpenCodeV2Tools(body, false);
          if (toolNameMap) body._v2ToolNameMap = toolNameMap;
        } else {
          cloakChatTools(body);
        }
      }
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  async execute(args) {
    const credentials = this.prepareRequestCredentials(args);
    // M4 — the both-lanes fallback the Star chose. If the v2 gate refuses a
    // free id with the FreeTierError shape, re-dial ONCE on the v1 lane
    // (/zen/v1 + v1 identity + v1 fingerprint). Deliberately narrow: a 401,
    // 429 or 5xx never falls back, because a genuine auth or rate failure must
    // not be laundered into "the old lane works".
    if (isOpenCodeFreeTierModel(args.model)) {
      // transformRequest owns the lane's body work (the tool_choice demotion,
      // the Responses normalization, and the v2 fingerprint), so it must run
      // BEFORE the dial — otherwise the raw caller body reaches the wire.
      const body = this.transformRequest(args.model, args.body, args.stream, credentials);
      const primary = await this.executeFreeLane({ ...args, body, credentials });
      if (!primary || !primary.response || primary.response.status !== 403 || !(await isFreeTierErrorResponse(primary.response))) {
        return primary;
      }
      const fallback = await this.executeFreeLane({ ...args, credentials }, true);
      return fallback || primary;
    }
    if (isOpencodeResponsesModel(args.model)) {
      const body = this.transformRequest(args.model, args.body, args.stream, credentials);
      return this.executeWithResponsesEndpoint({ ...args, body, credentials });
    }
    return super.execute({ ...args, credentials });
  }
  // Dial a free id on its chosen lane. `v1` forces the legacy lane so the
  // caller's own body is re-cloaked with the v1 fingerprint rather than the v2
  // one — the two lanes want different bodies, not just different headers.
  async executeFreeLane(args, v1 = false) {
    const { model, body, stream, credentials, signal, log, proxyOptions = null } = args;
    const responsesLane = isOpencodeResponsesModel(model);
    const prepared = v1 ? { ...body } : body;
    if (v1) {
      if (prepared && typeof prepared === "object") {
        if (responsesLane) {
          // The caller's chat-shaped body has to become a Responses payload
          // before it can be posted to /responses — the same conversion
          // executeWithResponsesEndpoint performs on the primary lane.
          const converted = openaiToOpenAIResponsesRequest(model, prepared, true, credentials);
          if (Array.isArray(converted.tools)) {
            const { toolNameMap } = this.concealFingerprintTools(converted);
            if (toolNameMap) converted._v1ToolNameMap = toolNameMap;
          }
          if (converted.max_output_tokens === undefined && (prepared.max_tokens !== undefined || prepared.max_completion_tokens !== undefined)) {
            converted.max_output_tokens = prepared.max_output_tokens ?? prepared.max_completion_tokens;
          }
          delete converted.max_tokens;
          delete converted.max_completion_tokens;
          Object.assign(prepared, converted);
        } else {
          cloakChatTools(prepared);
        }
      }
    } else if (prepared && typeof prepared === "object") {
      // The primary v2 lane: the body was already transformed by
      // transformRequest for free ids, but a direct caller of this helper
      // (the fallback's own second pass) may not have been — cloak idempotently.
      if (responsesLane) concealOpenCodeV2Tools(prepared, true);
      else concealOpenCodeV2Tools(prepared, false);
    }
    const url = v1 ? this.buildV1Url(model) : this.buildUrl(model);
    const headers = this.buildHeaders(credentials, stream, url);
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(prepared),
      signal,
    }, proxyOptions);
    if (!response.ok) return { response, url, headers, transformedBody: prepared };
    if (!response.body) {
      return { response: new Response("", { status: response.status, headers: response.headers }), url, headers, transformedBody: prepared };
    }
    const state = initState("openai");
    state.model = model;
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
          if (parsed.error) {
            controller.enqueue(new TextEncoder().encode(formatSSE(parsed.error, "openai")));
            continue;
          }
          // A Responses-lane free id (muse-spark) speaks /responses upstream, so
          // its SSE must be translated back to the OpenAI chat shape the client
          // expects — exactly as executeWithResponsesEndpoint does.
          const outChunk = isOpencodeResponsesModel(model)
            ? openaiResponsesToOpenAIResponse(parsed, state)
            : parsed;
          if (outChunk) {
            const restored = OpenCodeExecutor.restoreChunkToolNames(outChunk, v1 ? prepared?._v1ToolNameMap : prepared?._v2ToolNameMap);
            controller.enqueue(new TextEncoder().encode(formatSSE(restored, "openai")));
          }
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed) controller.enqueue(new TextEncoder().encode(formatSSE(parsed, "openai")));
        }
      },
    });
    return {
      response: new Response(response.body.pipeThrough(transformStream), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      url,
      headers,
      transformedBody: prepared,
    };
  }
  // The v1 endpoint for a free id — what this executor dialed before the v2
  // gate moved, kept only for the fallback.
  buildV1Url(model) {
    const base = this.config.baseUrl;
    if (isOpencodeResponsesModel(model)) return `${base}/zen/v1/responses`;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    // The v2 gate: free-tier ids no longer live at /zen/v1 at all (2026-10-15,
    // ported from 9router-go v1.9.12). A /zen/v1 call for them answers 403
    // FreeTierError, so the endpoint follows the free-tier predicate.
    if (isOpenCodeFreeTierModel(model)) {
      return isOpencodeResponsesModel(model)
        ? `${base}/inference/v1/responses`
        : `${base}/inference/v1/chat/completions`;
    }
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

    // The v2 gate reads a different identity than the v1 lane. A free-tier id
    // travels as the v2 CLI: the versioned v2 UA, `x-opencode-client: cli`, the
    // session mirrored on all four headers, the project back to the literal
    // "global", and NO `x-opencode-request` — the v2 gate rejects that header
    // outright (9router-go v1.9.12, internal/proxy/opencode.go).
    if (isOpenCodeFreeTierModel(url)) {
      const v2 = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${hasKey ? key : "public"}`,
        "x-api-key": hasKey ? key : "public",
        "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_V2_UA,
        "x-opencode-client": OPENCODE_V2_CLIENT,
        "x-opencode-project": OPENCODE_V2_PROJECT,
        "Accept": stream ? "text/event-stream" : "*/*",
      };
      for (const name of SESSION_MIRROR_HEADERS) v2[name] = session;
      return v2;
    }
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
