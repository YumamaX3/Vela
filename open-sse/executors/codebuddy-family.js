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
//
// The attempt-identity law (ported from codebuddy2api v1.5.4, app/request_context.py) rides
// here too: every dial carries the CLI's own fingerprint (SDK_HEADERS), a stable conversation
// id, and per-attempt trace headers; every credential dial names its uid/tenant/domain
// (app/client_profiles.py:55-72). The domestic WorkBuddy lane's escape is the backup ORIGIN
// (wb.tencentbuddy.com), one replay on the transient gateway statuses only — upstream
// _checked_chat_stream, converter.py:5028-5060.

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
import {
  shouldChannelFallback,
  channelFallbackUrl,
  workbuddyOriginFallbackUrl,
  shouldOriginFallback,
  isOriginReplaySafe,
} from "../shared/codebuddy/channelCheck.js";
import { ContentFilterDetector } from "../shared/codebuddy/contentFilter.js";
import { capabilityRefusal, declarationsFor } from "../shared/codebuddy/capabilityGate.js";
import { CODEBUDDY_PROFILES } from "../shared/codebuddy/profiles.js";
import { applyToolChoiceNormalization } from "../shared/codebuddy/toolChoice.js";
import { normalizeToolSchemas } from "../shared/codebuddy/toolSchema.js";
import { sessionKey, conversationId, attemptHeaders } from "../shared/codebuddy/attemptIdentity.js";
import { CODEBUDDY_PROFILE_DOMAINS } from "../shared/codebuddy/siteRouting.js";

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

/** Decode a JWT payload's claims without verifying — hints only, never authority.
 *  Upstream reads the uid the same way (app/auth_oauth.py:65-76, token_uid). */
function jwtClaims(accessToken) {
  if (typeof accessToken !== "string" || accessToken.split(".").length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

/** The credential identity headers upstream sends on every chat dial —
 *  app/client_profiles.py:55-72. Absent values become empty strings, exactly as
 *  upstream tolerates them; the uid falls back to the token's subject claim. */
function credentialContextHeaders(profile, credentials) {
  const account = credentials?.account && typeof credentials.account === "object" ? credentials.account : null;
  const claims = jwtClaims(credentials?.accessToken);
  const enterpriseId = String(account?.enterpriseId ?? account?.tenantId ?? "");
  return {
    "X-User-Id": String(account?.uid ?? claims?.sub ?? ""),
    "X-Enterprise-Id": enterpriseId,
    "X-Tenant-Id": enterpriseId,
    "X-Domain": CODEBUDDY_PROFILE_DOMAINS[profile.product] ?? "",
  };
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

    // The Go gateway reads tool_choice only as a STRING; an Anthropic-shaped object
    // earns 400 / 11101. The class applies it once, so all four products inherit the
    // same flattening and no profile field is needed.
    applyToolChoiceNormalization(transformed);

    // Schema normalization rides AFTER tool_choice: empty parameter roots become
    // object schemas, legacy field maps are wrapped, RE2-hostile `\_` escapes are
    // repaired in pattern positions only — copied only when something changed
    // (codebuddy2api v1.5.4, app/upstream_compat.py normalize_tool_schemas).
    const normalized = normalizeToolSchemas(transformed);

    // The message shape is the ONE structurally unequal axis: the domestic CodeBuddy
    // lane sanitises in place and keeps the client's array; the other three drop
    // system/developer and rebuild behind the product's own opener.
    const source = Array.isArray(normalized.messages) ? normalized.messages : [];
    if (this.profile.messageShape === "rebuild") {
      normalized.messages = [{ role: "system", content: this.profile.opener }];
      for (const message of source) {
        if (!message || typeof message !== "object") continue;
        if (message.role === "system" || message.role === "developer") continue;
        if (message.role === "user" && typeof message.content === "string") {
          normalized.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
        } else {
          normalized.messages.push({ ...message });
        }
      }
    } else if (this.profile.sanitise) {
      const { sanitizeCodeBuddySystemText } = this.#sanitiser();
      normalized.messages = source.map((message) => {
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

    return normalized;
  }

  /**
   * The identity headers on EVERY dial — primary included. Upstream's clock builds
   * attempt headers for each outgoing request (request_context.py:186-197); the
   * primary dial was the one request that carried no fingerprint at all. Auth
   * (Bearer/hooks) rides in first via the inherited build; the identity block and
   * the credential context overlay after it, and a diverted dial (runtimeTransport
   * baseUrl) marks its diversion so logs can trace the rescue.
   *
   * @param {object} credentials
   * @param {boolean} stream
   * @param {string} url
   * @param {string} model
   * @param {object} [body] - the TRANSFORMED body; sessionKey derives from it here
   * @returns {Record<string,string>}
   */
  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    const divertedUrl = credentials?.runtimeTransport?.baseUrl || null;
    const skey = sessionKey(body) ?? crypto.randomUUID().replace(/-/g, "");
    const identity = credentials?.account?.uid ?? jwtClaims(credentials?.accessToken)?.sub ?? "";
    const conv = conversationId(this.profile.product, identity, skey);
    Object.assign(headers, attemptHeaders(headers, this.profile.product, { conversationId: conv }));
    Object.assign(headers, credentialContextHeaders(this.profile, credentials));
    if (divertedUrl) headers["X-Diverted-Url"] = divertedUrl;
    return headers;
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
    // The breaker key is derived per request from the credential — every breaker
    // call in this method reads it, so it binds at the head, before any return.
    const key = this.breakerKey(credentials);
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
      const status = result.response.status;

      // The domestic WorkBuddy lane's escape comes FIRST (upstream _checked_chat_stream
      // tries the origin replay before the channel fallback): a transient gateway
      // status with a replay-safe body earns exactly ONE dial against the backup
      // origin — never a business refusal, never twice.
      const originUrl = workbuddyOriginFallbackUrl(result.url || this.config?.baseUrl || "", this.profile.product);
      if (originUrl && shouldOriginFallback(originUrl, status)) {
        let raw = "";
        try {
          raw = await result.response.clone().text();
        } catch { /* unreadable body — treat as replay-safe-empty */ }
        if (isOriginReplaySafe(raw)) {
          log?.debug?.("CODEBUDDY", `${this.provider}: transient ${status} — one replay via ${WORKBUDDY_CN_BACKUP_ORIGIN_LABEL}`);
          const retried = await this.#dialOrigin(originUrl, opts);
          if (retried?.response?.ok) {
            const wrapped = await wrapCodeBuddyStream(retried.response, opts.model);
            if (wrapped.ok) breakerRecordSuccess(key);
            return { ...retried, response: wrapped };
          }
          if (retried) return retried;
        }
      }

      const channelRefusal = await this.#channelRefusal(result);
      if (channelRefusal) {
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
   * One dial against the backup origin.
   *
   * The diversion rides the credentials object (runtimeTransport.baseUrl) exactly as
   * the console door does — never on `this` — and the identity headers are rebuilt
   * for the diverted dial so the attempt trace stays fresh.
   */
  async #dialOrigin(originUrl, opts) {
    return await super.execute({
      ...opts,
      credentials: {
        ...opts.credentials,
        runtimeTransport: {
          ...(opts.credentials?.runtimeTransport || {}),
          baseUrl: originUrl,
        },
      },
    });
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
          // The TRANSPORT headers must survive the diversion (X-IDE-*/User-Agent) —
          // the identity block overlays in buildHeaders regardless of rt presence.
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

// The backup origin's label for logs — same constant the channel-check module holds.
import { WORKBUDDY_CN_BACKUP_ORIGIN as WORKBUDDY_CN_BACKUP_ORIGIN_LABEL } from "../shared/codebuddy/channelCheck.js";

// Imported at module scope to avoid a circular lazy-init dance; the sanitiser is
// a pure function with no side effects, so loading it with the class costs nothing.
import { sanitizeCodeBuddySystemText as sanitizeCodeBuddySystemTextLazy } from "../shared/codebuddy/gate.js";

export default CodeBuddyFamilyExecutor;
