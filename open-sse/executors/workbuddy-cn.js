import { DefaultExecutor } from "./default.js";
import {
  wrapCodeBuddyStream,
  breakerTryAdmit,
  breakerRecordFailure,
  breakerRecordSuccess,
  refreshCodeBuddyToken,
} from "../shared/codebuddy/gate.js";
import { shouldChannelFallback, channelFallbackUrl } from "../shared/codebuddy/channelCheck.js";

/**
 * WorkBuddyCnExecutor — talks to https://www.workbuddy.cn/v2/chat/completions
 *
 * Same wire shape as its CodeBuddy sibling: OpenAI-compatible but stream-only,
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like its CodeBuddy sibling.
 *
 * The ascension (v0.9.34): business-envelope errors (`{code, msg}` inside
 * HTTP 200 — as a JSON body or an SSE frame) are caught by the shared honest
 * gate so they surface as real non-200 responses and combo fallback engages.
 * No sanitize layer here — transformRequest already drops client system
 * messages and rebuilds with its own canonical opener.
 */
export class WorkBuddyCnExecutor extends DefaultExecutor {
  constructor() {
    super("workbuddy-cn");
    // Set only for the single console-door retry; null on every other path.
    this._forcedUrl = null;
  }

  // The base executor builds the URL from the registry every call. A confirmed
  // channel rejection needs exactly one dial against the console door, so the URL
  // is diverted here rather than invented at the call site.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this._forcedUrl) return this._forcedUrl;
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  // Same frequency-limit envelope as the CN gateway: code 6004 or plain
  // wording, sometimes inside a 200. Translate to 429 + resetsAtMs so the
  // classifier cools the account down instead of reading a request fault.
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
        // Account/IP block wording. Both messages arrive as HTTP 400 and read
        // request-scoped to the generic classifier, so they are named here — the
        // bare envelope would only match by substring inside raw JSON.
        if (/request illegal|conversation id missing/i.test(msg)) {
          return { status: response.status, message: msg };
        }
      } catch { /* fall through to default */ }
    }
    return super.parseError(response, bodyText);
  }

  breakerKey(credentials) {
    return credentials?.connectionId || "workbuddy-cn:unknown";
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

    // The gateway rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    // WorkBuddy's own client opens with this identity (reference: desensitize.py,
    // _DSH_WORKBUDDY_IDENTITY). The CodeBuddy lanes send "You are CodeBuddy Code."
    // instead — the two products answer to different openers, and using one for
    // the other is the substitution this tide exists to stop.
    transformed.messages = [{ role: "system", content: "You are WorkBuddy, a powerful AI assistant." }];
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

  /** One-shot token recovery — the shared gate module, identical across all four products. */
  async refreshCredentials(credentials, log, proxyOptions = null) {
    const cfg = this.config?.oauth || {};
    if (!cfg.refreshUrl) return null;
    const result = await refreshCodeBuddyToken(credentials, {
      refreshUrl: cfg.refreshUrl,
      userAgent: cfg.userAgent || this.config?.headers?.["User-Agent"],
    });
    if (result) log?.info?.("TOKEN", "workbuddy-cn refreshed");
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
      // The primary `v2/chat/completions` door fronts a client-identity check and
      // rejects an unrecognised caller with business code 11128 — as HTTP 400, which
      // the generic classifier would read as a request fault and never cool down.
      // The console door carries no such check, so a CONFIRMED channel rejection
      // earns exactly one retry there. Anything else falls through untouched.
      const fallbackUrl = channelFallbackUrl(result.url || this.config?.baseUrl || "");
      if (shouldChannelFallback(fallbackUrl, result.response.status, await result.response.clone().text())) {
        log?.info?.("CODEBUDDY", "channel verification refused — one retry on the console door");
        try {
          this._forcedUrl = fallbackUrl;
          const retried = await super.execute(opts);
          this._forcedUrl = null;
          if (retried.response.ok) {
            const wrappedRetry = await wrapCodeBuddyStream(retried.response, opts.model);
            if (wrappedRetry.ok) breakerRecordSuccess(key);
            return { ...retried, response: wrappedRetry };
          }
        } catch {
          // The console door failed too — report the ORIGINAL refusal, which names
          // the channel check the caller actually hit.
        }
      }
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

export default WorkBuddyCnExecutor;
