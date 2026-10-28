// The CodeBuddy family — one hull, four shores.
//
// Four products answer to one wire shape and four hosts: CodeBuddy CN (copilot.tencent.com),
// WorkBuddy CN (www.workbuddy.cn), CodeBuddy Intl (www.codebuddy.ai) and WorkBuddy Intl
// (www.workbuddy.ai). Vela carried them as four near-identical executors; the copies had
// already begun to disagree — one lost its console-door fallback, another held a diverted
// URL on a shared singleton, and a third wrote every WorkBuddy cooldown as a CodeBuddy one.
//
// This module replaces all four with one class and a frozen table. EVERY difference between
// the products is a field on the profile. The class never asks which product it is serving;
// if a behaviour differs, the difference is data, and a product id never appears as a branch.
//
// No request state lives on `this`. The executors are module-load singletons, so a field on
// the instance is a field shared by every concurrent request — the old `_forcedUrl` was not
// only a race, it was a permanent hijack when its reset was skipped by a throw.

import { DefaultExecutor } from "./default.js";
import {
  wrapCodeBuddyStream,
  sanitizeCodeBuddySystemText,
  breakerTryAdmit,
  breakerRecordFailure,
  breakerRecordSuccess,
  breakerRecordAnswered,
  refreshCodeBuddyToken,
} from "../shared/codebuddy/gate.js";
import { shouldChannelFallback, channelFallbackUrl } from "../shared/codebuddy/channelCheck.js";
import { ContentFilterDetector } from "../shared/codebuddy/contentFilter.js";
import { capabilityRefusal, declarationsFor } from "../shared/codebuddy/capabilityGate.js";
import { CODEBUDDY_PROFILES } from "../shared/codebuddy/profiles.js";

function breakerOpenResponse() {
  return new Response(
    JSON.stringify({
      error: {
        message: "codebuddy: credential circuit breaker open — try another account",
        type: "rate_limit_error",
        code: "breaker_open",
      },
    }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  );
}

export class CodeBuddyFamilyExecutor extends DefaultExecutor {
  // M4's binding lives in src/instrumentation.js now — fire-and-forget at
  // boot, not on the request path. No per-request state belongs on a
  // module-load singleton, and this class holds none.

  /**
   * @param {string} providerId - one of the four family ids
   */
  constructor(providerId) {
    const profile = CODEBUDDY_PROFILES[providerId];
    if (!profile) throw new Error(`CodeBuddy family: no profile for "${providerId}"`);
    super(providerId);
    // Frozen at construction and never read from anywhere else. Private so no
    // later code can reach in and mutate a shared decision.
    Object.defineProperty(this, "profile", { value: profile, writable: false, enumerable: false });
  }

  /**
   * The breaker key names its product. A shared connection across two products
   * must not collide, and the ledger reads this prefix to file the row.
   */
  breakerKey(credentials) {
    return `${this.provider}:${credentials?.connectionId || "unknown"}`;
  }

  // Same frequency-limit envelope on every shore: code 6004, or plain wording,
  // sometimes inside a 200. Translate to 429 + resetsAtMs so the classifier cools
  // the account instead of reading a request fault.
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${match[1]}T${match[2]}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return { status: 429, message: msg || "CodeBuddy frequency limit (6004)", resetsAtMs };
        }
        // Account/IP block wording — request-scoped to the generic classifier,
        // so it is named here rather than matched by substring inside raw JSON.
        if (/request illegal|conversation id missing/i.test(msg)) {
          return { status: response.status, message: msg };
        }
      } catch { /* fall through to the inherited parse */ }
    }
    return super.parseError(response, bodyText);
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    // The upstream rejects non-stream chat requests (HTTP 400, code 11101).
    // Vela re-aggregates the SSE into a JSON response for non-streaming clients.
    transformed.stream = true;

    // Reasoning is surfaced only when the request carries the CLI's OpenAI-style
    // params. Mirror the CLI when the client asked; set nothing when it did not —
    // forcing both makes the upstream trip its content filter (#2071).
    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // The message shape is the ONE structurally unequal axis: the domestic CodeBuddy
    // lane sanitises in place and keeps the client's array; the other three drop
    // system/developer and rebuild behind the product's own opener.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    if (this.profile.messageShape === "rebuild") {
      transformed.messages = [{ role: "system", content: this.profile.opener }];
      for (const message of source) {
        if (!message || typeof message !== "object") continue;
        if (message.role === "system" || message.role === "developer") continue;
        if (message.role === "user" && typeof message.content === "string") {
          transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
        } else {
          transformed.messages.push({ ...message });
        }
      }
    } else if (this.profile.sanitise) {
      const { sanitizeCodeBuddySystemText } = this.#sanitiser();
      transformed.messages = source.map((message) => {
        if (!message || message.role !== "system") return message;
        if (typeof message.content === "string") {
          return { ...message, content: sanitizeCodeBuddySystemText(message.content) };
        }
        if (Array.isArray(message.content)) {
          return {
            ...message,
            content: message.content.map((p) =>
              p && typeof p.text === "string" ? { ...p, text: sanitizeCodeBuddySystemText(p.text) } : p,
            ),
          };
        }
        return message;
      });
    }

    return transformed;
  }

  /** Loaded lazily so the family does not drag the sanitiser into every import path. */
  #sanitiser() {
    return { sanitizeCodeBuddySystemText: sanitizeCodeBuddySystemTextLazy };
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    const cfg = this.config?.oauth || {};
    if (!cfg.refreshUrl) return null;
    const result = await refreshCodeBuddyToken(credentials, {
      refreshUrl: cfg.refreshUrl,
      userAgent: this.profile.refreshUserAgent || cfg.userAgent || this.config?.headers?.["User-Agent"],
    });
    if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
    return result;
  }

  async execute(opts) {
    const { credentials, log } = opts;
    // M5 — the capability gate refuses BEFORE a credit is spent, and before the
    // breaker is touched. A refusal here is the request's fault, not the account's.
    // It is a 400 matching no ERROR_RULES text entry, so it classifies as
    // request-scoped: the account is never cooled and combo fallback still advances.
    const refusal = capabilityRefusal(opts.body, opts.model, declarationsFor(this.provider));
    if (refusal) {
      log?.debug?.("CODEBUDDY", `${this.provider}: capability refusal — ${refusal.message}`);
      return {
        response: new Response(
          JSON.stringify({ error: { message: refusal.message, type: "invalid_request_error", code: refusal.code } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
        url: this.buildUrl(opts.model, opts.stream, 0, credentials),
        headers: {},
        transformedBody: opts.body,
      };
    }

    // While the breaker is open, surface a synthetic 429 so account selection
    // rotates instead of hammering a credential that is already known dead.
    if (!breakerTryAdmit(key)) {
      log?.debug?.("CODEBUDDY", `breaker open — rotating away from ${key}`);
      return {
        response: breakerOpenResponse(),
        url: this.buildUrl(opts.model, opts.stream, 0, credentials),
        headers: {},
        transformedBody: opts.body,
      };
    }

    const result = await super.execute(opts);

    if (!result.response.ok) {
      const refusal = await this.#channelRefusal(result);
      if (refusal) {
        // A confirmed channel rejection on the primary door earns exactly ONE retry
        // against the console door — never more, and never for another path.
        if (this.profile.consoleDoor) {
          const retried = await this.#dialConsoleDoor(opts);
          if (retried?.response?.ok) {
            const wrapped = await wrapCodeBuddyStream(retried.response, opts.model);
            if (wrapped.ok) breakerRecordSuccess(key);
            return { ...retried, response: wrapped };
          }
        }
        // The body earned the refusal — the credential answered. Recording this as a
        // fault is what kept the breaker re-arming itself one probe a minute forever.
        breakerRecordAnswered(key);
        return result;
      }

      // A 4xx the request itself earned is not the account's death either. Only a
      // status that says "this credential or this shore is in trouble" is recorded.
      const status = result.response.status;
      if (status === 401 || status === 403 || status === 429 || status >= 500) {
        breakerRecordFailure(key);
      } else {
        breakerRecordAnswered(key);
      }
      return result;
    }

    const wrapped = await wrapCodeBuddyStream(result.response, opts.model);
    if (!wrapped.ok) breakerRecordFailure(key);
    else {
      // The upstream answers a sensitivity block by streaming a canned apology and
      // closing with `finish_reason: "stop"` — indistinguishable from a real answer
      // downstream, so the combo logs success and the client eats the refusal. The
      // detector peeks: a pure refusal is surfaced as an error the fallback can act on.
      const guarded = await this.#guardAgainstRefusal(wrapped, opts.model);
      if (guarded?.ok) breakerRecordSuccess(key);
      else breakerRecordAnswered(key);
      return { ...result, response: guarded || wrapped };
    }
    return { ...result, response: wrapped };
  }

  /**
   * Peek the stream just far enough to know whether the turn was a refusal wearing
   * a clean stop. A pure refusal becomes an honest non-200 so combo fallback fires;
   * anything else is replayed untouched. Never throws — a detector failure must not
   * cost the caller an answer that was real.
   */
  async #guardAgainstRefusal(response, model) {
    if (!response?.ok || !response.body) return response;
    const contentType = response.headers?.get?.("content-type") || "";
    if (!contentType.includes("text/event-stream")) return response;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const detector = new ContentFilterDetector();

    let buffered = "";
    let sawDone = false;
    // Read until the finish reason is known, the stream ends, or the window is full.
    while (!sawDone) {
      let read;
      try {
        read = await reader.read();
      } catch {
        return response;
      }
      if (read.done) break;
      buffered += decoder.decode(read.value, { stream: true });
      // Process only COMPLETE lines, then keep the partial tail. Re-splitting the
      // whole buffer on every read would re-parse everything (O(n^2)) and — worse —
      // a `[DONE]` arriving mid-buffer would strand every line after it, because the
      // drained reader cannot give them back.
      const cut = buffered.lastIndexOf("\n");
      if (cut === -1) continue;
      const complete = buffered.slice(0, cut + 1);
      buffered = buffered.slice(cut + 1);
      for (const line of complete.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") { sawDone = true; continue; }
        try {
          const chunk = JSON.parse(data);
          const choice = chunk?.choices?.[0];
          if (choice?.delta) detector.feed(choice.delta, choice.finish_reason ?? null);
          if (choice?.finish_reason) sawDone = true;
        } catch { /* a non-JSON frame is not a refusal signal */ }
      }
      if (detector.overflow) break;
    }

    if (!detector.detected) {
      // Not a refusal — replay everything peeked, then stream the remainder verbatim.
      const replay = new ReadableStream({
        start(controller) {
          if (buffered) controller.enqueue(encoder.encode(buffered));
          const pump = () => reader.read().then((next) => {
            if (next.done) { controller.close(); return; }
            controller.enqueue(next.value);
            pump();
          }, () => controller.close());
          pump();
        },
        cancel() { return reader.cancel().catch(() => {}); },
      });
      return new Response(replay, {
        status: response.status,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    try { await reader.cancel(); } catch { /* already closed */ }
    if (!detector.retrySafe) {
      // The model may have been mid-work: surface the refusal, but do not invite a
      // replay that would double-spend the call.
      return new Response(
        JSON.stringify({
          error: {
            message: "codebuddy: upstream refused on content grounds after partial output",
            type: "invalid_request_error",
            code: "content_filter",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        error: {
          message: "codebuddy: upstream refused on content grounds",
          type: "invalid_request_error",
          code: "content_filter",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  /**
   * A confirmed channel rejection: HTTP 400 AND both halves of the 11128 signal.
   * The body is cloned so the original response still reaches the caller intact.
   */
  async #channelRefusal(result) {
    if (!result?.response || result.response.status !== 400) return false;
    const fallback = channelFallbackUrl(result.url || this.config?.baseUrl || "");
    if (!fallback) return false;
    try {
      return shouldChannelFallback(fallback, result.response.status, await result.response.clone().text());
    } catch {
      return false;
    }
  }

  /**
   * One dial against the console door.
   *
   * The old lanes held the diverted URL on `this`, which leaked it into every later
   * request whenever a throw skipped the reset. The diversion must therefore never
   * touch the instance: it is passed through the credentials object, which the base
   * executor threads into buildUrl for this single call and which is discarded with
   * the request that created it.
   */
  async #dialConsoleDoor(opts) {
    const primary = this.buildUrl(opts.model, opts.stream, 0, opts.credentials);
    const fallback = channelFallbackUrl(primary);
    if (!fallback) return null;
    return await super.execute({
      ...opts,
      credentials: {
        ...opts.credentials,
        runtimeTransport: {
          // The identity headers MUST survive the diversion. `buildHeaders` reads
          // `rt.headers` when a runtime transport is present, so an rt carrying only
          // a baseUrl would strip every X-IDE-*/User-Agent and earn the same 11128
          // refusal the console door exists to escape.
          ...(opts.credentials?.runtimeTransport || { headers: this.config?.headers || {} }),
          baseUrl: fallback,
        },
      },
    });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // A request-carried diversion wins for exactly one dial. DefaultExecutor
    // already honours `credentials.runtimeTransport.baseUrl`; resolving it here
    // as well keeps the family independent of that implementation detail.
    const diverted = credentials?.runtimeTransport?.baseUrl;
    if (diverted) return diverted;
    const url = super.buildUrl(model, stream, urlIndex, credentials);
    // The product's own host is authoritative; a registry that drifts must not
    // silently send this lane to another shore.
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== this.profile.host) parsed.hostname = this.profile.host;
      return parsed.toString();
    } catch {
      return url;
    }
  }
}

// Imported at module scope to avoid a circular lazy-init dance; the sanitiser is
// a pure function with no side effects, so loading it with the class costs nothing.
import { sanitizeCodeBuddySystemText as sanitizeCodeBuddySystemTextLazy } from "../shared/codebuddy/gate.js";

export default CodeBuddyFamilyExecutor;
