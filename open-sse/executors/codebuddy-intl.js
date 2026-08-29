import { DefaultExecutor } from "./default.js";
import {
  wrapCodeBuddyStream,
  breakerTryAdmit,
  breakerRecordFailure,
  breakerRecordSuccess,
  refreshCodeBuddyToken,
} from "../shared/codebuddy/gate.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 *
 * The ascension (v0.9.34): business-envelope errors (`{code, msg}` inside
 * HTTP 200 — as a JSON body or an SSE frame) are caught by the shared honest
 * gate so they surface as real non-200 responses and combo fallback engages.
 * No sanitize layer here — transformRequest already drops client system
 * messages and rebuilds with its own canonical opener.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  breakerKey(credentials) {
    return credentials?.connectionId || "codebuddy-intl:unknown";
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }

  /** One-shot token recovery — mirrors CodeBuddyExecutor (shared gate module). */
  async refreshCredentials(credentials, log, proxyOptions = null) {
    const cfg = this.config?.oauth || {};
    if (!cfg.refreshUrl) return null;
    const result = await refreshCodeBuddyToken(credentials, {
      refreshUrl: cfg.refreshUrl,
      userAgent: cfg.userAgent || this.config?.headers?.["User-Agent"],
    });
    if (result) log?.info?.("TOKEN", "codebuddy-intl refreshed");
    return result;
  }

  async execute(opts) {
    const { credentials, log } = opts;
    const key = this.breakerKey(credentials);

    if (!breakerTryAdmit(key)) {
      log?.debug?.("CODEBUDDY", `breaker open — rotating away from ${key}`);
      const response = new Response(
        JSON.stringify({ error: { message: "codebuddy: credential circuit breaker open — try another account", type: "rate_limit_error", code: "breaker_open" } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
      return { response, url: this.buildUrl(opts.model, opts.stream, 0, credentials), headers: {}, transformedBody: opts.body };
    }

    const result = await super.execute(opts);

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

export default CodeBuddyIntlExecutor;
