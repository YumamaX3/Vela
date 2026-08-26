import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";

const OPENCODE_UA = "opencode";
const MESSAGES_MODELS = new Set();

function generateRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

// Normalize any resolved id into opencode's ses_ format (stable per-conversation)
function toOpencodeSession(id) {
  const stripped = String(id || "").replace(/^ses_/, "").replace(/-/g, "");
  return stripped ? `ses_${stripped}` : null;
}

function resolveOpencodeSession(body, credentials) {
  return toOpencodeSession(resolveSessionId({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode",
  }));
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model, body, stream, credentials) {
    return injectReasoningContent({ provider: this.provider, model, body });
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
    const isOpencodeDownstream = downstreamUa.toLowerCase().includes("opencode");

    // Hybrid lane: a connection holding an OpenCode API key (apikey connection)
    // rides authenticated Zen — lifted limits, paid models. The virtual
    // keyless connection (accessToken "public", injected by auth.js when no
    // apikey connection exists) keeps the free zen lane open.
    const key = credentials?.apiKey || credentials?.accessToken;
    const hasKey = typeof key === "string" && key && key !== "public";

    // Session derived deterministically from the request headers — the same
    // source resolveOpencodeSession uses in transformRequest, so no singleton
    // instance state can leak between concurrent requests (E-M1). Only trust
    // the derivation when the request actually carries a conversation anchor
    // (session header or connectionId); otherwise emit a fresh clean id.
    const hasAnchor =
      raw["x-opencode-session"] ||
      raw["x-session-id"] ||
      raw["x-conversation-id"] ||
      credentials?.connectionId;
    const session = hasAnchor
      ? (toOpencodeSession(resolveSessionId({
          headers: raw,
          body: {},
          connectionId: credentials?.connectionId,
          scope: "opencode",
        })) || generateSessionId())
      : generateSessionId();

    return {
      "Content-Type": "application/json",
      "Authorization": hasKey ? `Bearer ${key}` : "Bearer public",
      "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": lower["x-opencode-client"] || "desktop",
      "x-opencode-session": lower["x-opencode-session"] || session,
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      "x-opencode-project": lower["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*",
    };
  }
}
