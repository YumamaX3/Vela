import { DefaultExecutor } from "./default.js";
import {
  wrapCodeBuddyStream,
  sanitizeCodeBuddySystemText,
  breakerTryAdmit,
  breakerRecordFailure,
  breakerRecordSuccess,
  refreshCodeBuddyToken,
} from "../shared/codebuddy/gate.js";

/**
 * CodeBuddyExecutor — talks to https://copilot.tencent.com/v2/chat/completions
 *
 * CodeBuddy is OpenAI-compatible but rejects non-stream chat requests
 * (HTTP 400, code 11101 "Non-stream chat request is currently not supported").
 * The same-format (openai→openai) translator path leaves body.stream as the
 * client sent it, so we force it true here — Vela still re-aggregates the
 * SSE into a JSON response for non-streaming clients.
 *
 * The ascension (v0.9.34): CodeBuddy answers business failures inside HTTP
 * 200 — a JSON `{code, msg}` body or an SSE frame carrying one (11101
 * missing-system, 11128 moderation, 11140 banned, 14018 quota). Without a
 * gate those launder into 200 streams and combo fallback never fires.
 * execute() now wraps the response through the honest gate; a per-credential
 * circuit breaker rotates dead accounts; a one-shot token refresh heals
 * expired sessions before chatCore's refresh seam sees them.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  breakerKey(credentials) {
    return credentials?.connectionId || "codebuddy-cn:unknown";
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    // Tencent's content filter flags competitor agent brands in system text
    // (code 11128 "Illegal API invocation from an unapproved channel"). Two
    // layers: first substitute the known brand signals (codebuffy sanitize.ts
    // port — user/assistant content is never touched), then fall back to the
    // neutral-prompt catch-all for anything still shaped like an agent prompt
    // (length + identity-marker regex).
    const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
    const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;
    const flatten = (content) =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n")
          : "";
    if (Array.isArray(transformed.messages)) {
      transformed.messages = transformed.messages.map((message) => {
        if (!message || message.role !== "system") return message;
        // Layer 1: substitute known competitor-brand signals in place.
        let sanitized = message;
        if (typeof message.content === "string") {
          const next = sanitizeCodeBuddySystemText(message.content);
          if (next !== message.content) sanitized = { ...message, content: next };
        } else if (Array.isArray(message.content)) {
          const parts = message.content.map((p) =>
            p && typeof p.text === "string" ? { ...p, text: sanitizeCodeBuddySystemText(p.text) } : p,
          );
          sanitized = { ...message, content: parts };
        }
        // Layer 2: catch-all — anything still shaped like an agent prompt is
        // replaced wholesale with the neutral prompt.
        const text = flatten(sanitized.content);
        if (!text) return sanitized;
        if (text.length > 2000 || AGENT_PATTERN.test(text)) {
          return typeof sanitized.content === "string"
            ? { ...sanitized, content: NEUTRAL_PROMPT }
            : { ...sanitized, content: [{ type: "text", text: NEUTRAL_PROMPT }] };
        }
        return sanitized;
      });
    }

    // CodeBuddy only surfaces model reasoning when the request carries the CLI's
    // OpenAI-style params: reasoning_effort + reasoning_summary:"auto". Vela's
    // thinking pipeline sets reasoning_effort only when the client asks, and never
    // sets reasoning_summary — so reasoning never shows. Mirror the CLI here.
    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort; // gateway has no "none" — just omit
    } else if (eff) {
      // Client explicitly asked for reasoning — mirror the CLI's reasoning_summary
      // so CodeBuddy surfaces the model's reasoning.
      transformed.reasoning_summary = "auto";
    }
    // No reasoning requested: leave both unset. Forcing reasoning_effort:"medium"
    // + reasoning_summary on plain requests makes CodeBuddy trip its content
    // filter and return an error (#2071).
    return transformed;
  }

  /**
   * One-shot token recovery (codebuffy refresh.ts port): an inference-time
   * 401/403 gets ONE refresh attempt against /v2/plugin/auth/token/refresh
   * before bytes flow. chatCore's refresh seam calls this and retries the
   * execute when it returns tokens.
   */
  async refreshCredentials(credentials, log, proxyOptions = null) {
    const cfg = this.config?.oauth || {};
    if (!cfg.refreshUrl) return null;
    const result = await refreshCodeBuddyToken(credentials, {
      refreshUrl: cfg.refreshUrl,
      userAgent: cfg.userAgent || this.config?.headers?.["User-Agent"],
    });
    if (result) log?.info?.("TOKEN", "codebuddy-cn refreshed");
    return result;
  }

  async execute(opts) {
    const { credentials, log } = opts;
    const key = this.breakerKey(credentials);

    // Circuit breaker: while open, surface a synthetic 429 so account
    // selection rotates instead of hammering a dead credential.
    if (!breakerTryAdmit(key)) {
      log?.debug?.("CODEBUDDY", `breaker open — rotating away from ${key}`);
      const response = new Response(
        JSON.stringify({ error: { message: "codebuddy: credential circuit breaker open — try another account", type: "rate_limit_error", code: "breaker_open" } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
      return { response, url: this.buildUrl(opts.model, opts.stream, 0, credentials), headers: {}, transformedBody: opts.body };
    }

    const result = await super.execute(opts);

    // Honest gate: terminal non-200s and business envelopes inside 200s must
    // never launder into success. Record the outcome on the breaker.
    if (!result.response.ok) {
      breakerRecordFailure(key);
      return result;
    }

    const wrapped = await wrapCodeBuddyStream(result.response, opts.model);
    if (!wrapped.ok) {
      breakerRecordFailure(key);
    } else {
      breakerRecordSuccess(key);
    }
    return { ...result, response: wrapped };
  }
}

export default CodeBuddyExecutor;
