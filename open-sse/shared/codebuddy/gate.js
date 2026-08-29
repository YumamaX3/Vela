/**
 * CodeBuddy shared gate — the honest-gate pattern (qoder v0.9.30) adapted to
 * CodeBuddy's wire. Single module, both providers (cn + intl).
 *
 * CodeBuddy is OpenAI-compatible but answers business failures in THREE
 * deceptive shapes — all inside HTTP 200:
 *   1. 200 + application/json body `{code, msg}` (non-stream refusal)
 *   2. first SSE frame carrying `{code, msg}` (refusal before any content)
 *   3. mid-stream SSE frame carrying `{code, msg}` (refusal after content)
 * Without a gate, all three launder into 200 streams: chatCore sees success,
 * no combo fallback fires, and the client eats the raw error text.
 *
 * Business codes (reference trefeon/codebuffy errors.ts + openai.ts):
 *   11101 missing-system → 400 · 11128 moderation → 400 ·
 *   11140 banned → 403 · 14018 quota → 429.
 *
 * System-prompt desensitization (codebuffy sanitize.ts): Tencent's content
 * filter rejects competitor agent brands in system text (11128) — substitute,
 * never replace wholesale; user/assistant content is never touched.
 *
 * Per-credential circuit breaker (codebuffy breaker.ts): 5 consecutive
 * terminal failures open the breaker for 60s; a single half-open probe
 * re-admits; success closes. While open, the executor surfaces a synthetic
 * 429 so account selection rotates instead of hammering a dead credential.
 */
import { SSE_DONE } from "../../utils/sseConstants.js";

// ── business-code taxonomy ──────────────────────────────────────────────────
export const CODEBUDDY_BUSINESS_CODE_HTTP = {
  11101: 400, // missing-system (non-stream / shape refusals)
  11128: 400, // moderation / unapproved-channel content filter
  11140: 403, // banned credential
  14018: 429, // quota exhausted
};

export const CODEBUDDY_RETRYABLE_CODES = new Set([401, 403, 429, 500, 502, 503, 504, 11140, 14018]);

const CODEBUDDY_BUSINESS_LABELS = {
  11101: "missing-system",
  11128: "moderation",
  11140: "banned",
  14018: "quota",
};

/** Map a business code to its honest HTTP status (unknown codes → 502). */
export function businessCodeToHttpStatus(code) {
  const n = Number(code);
  if (CODEBUDDY_BUSINESS_CODE_HTTP[n]) return CODEBUDDY_BUSINESS_CODE_HTTP[n];
  if (Number.isFinite(n) && n >= 400 && n < 600) return n; // already an HTTP status
  return 502;
}

/** Human label for a business code. */
export function businessCodeLabel(code) {
  return CODEBUDDY_BUSINESS_LABELS[Number(code)] || `upstream code ${code}`;
}

/**
 * Detect a business envelope: an object carrying a non-zero `code` field.
 * Returns { code, msg } or null. Plain OpenAI chunks never carry `code`.
 */
export function classifyBusinessEnvelope(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const code = json.code;
  if (code === undefined || code === null || code === 0 || code === "0") return null;
  const msg = typeof json.msg === "string" ? json.msg
    : typeof json.message === "string" ? json.message
    : null;
  return { code, msg };
}

/** Build the honest non-200 JSON response for a business envelope. */
export function businessEnvelopeResponse(env) {
  const status = businessCodeToHttpStatus(env.code);
  const label = businessCodeLabel(env.code);
  const message = `codebuddy ${label} (${env.code})${env.msg ? `: ${String(env.msg).slice(0, 200)}` : ""}`;
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error",
        code: String(env.code),
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// ── the honest gate (stream wrapper) ────────────────────────────────────────

/**
 * Wrap a CodeBuddy upstream response:
 *   - 200 + application/json envelope → honest mapped non-200
 *   - first SSE frame envelope → honest mapped non-200 (nothing streamed yet)
 *   - mid-stream envelope → graceful degradation (error chunk + clean [DONE])
 *   - everything else passes through untouched.
 * Never throws; any unexpected shape degrades to passthrough.
 */
export async function wrapCodeBuddyStream(response, model) {
  if (!response || !response.ok || !response.body) return response;

  const contentType = response.headers?.get?.("content-type") || "";

  // Shape 1: 200 + JSON business envelope.
  if (contentType.includes("application/json")) {
    let text = "";
    try { text = await response.text(); } catch { return response; }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {
      // 200 JSON that won't parse — nothing the stream can carry.
      return new Response(
        JSON.stringify({ error: { message: "codebuddy: unparseable JSON response", type: "api_error", code: "bad_upstream_json" } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    const env = classifyBusinessEnvelope(parsed);
    if (env) return businessEnvelopeResponse(env);
    // code 0 envelope: unwrap a data chunk when one hides inside, else fail
    // honestly — a non-stream JSON answer to a forced-stream request must not
    // reach an SSE-expecting client as a silent 200.
    const inner = parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
    if (inner && Array.isArray(inner.choices)) {
      const chunk = JSON.stringify(inner);
      const body = `data: ${chunk}\n\n${SSE_DONE}`;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }
    return new Response(
      JSON.stringify({ error: { message: "codebuddy: unexpected non-stream response", type: "api_error", code: "unexpected_upstream_shape" } }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // Shapes 2 + 3: SSE with a possible business-envelope frame. Peek the first
  // frame; everything the peek consumes is re-processed so nothing is dropped.
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const encoder = new TextEncoder();

  let consumed = "";
  let peekedFrame = null;   // first parsed data frame
  let streamEnded = false;

  while (peekedFrame === null && !streamEnded) {
    let read;
    try { read = await reader.read(); } catch { return response; }
    if (read.done) { streamEnded = true; break; }
    consumed += decoder.decode(read.value, { stream: true });

    let nl;
    while ((nl = consumed.indexOf("\n")) !== -1) {
      const line = consumed.slice(0, nl).replace(/\r$/, "").trim();
      consumed = consumed.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trimStart();
      if (data === "[DONE]") { streamEnded = true; break; }
      try {
        peekedFrame = JSON.parse(data);
        break;
      } catch { /* not JSON — keep peeking */ }
    }
  }

  if (peekedFrame !== null) {
    const env = classifyBusinessEnvelope(peekedFrame);
    if (env) {
      // First-frame failure — honest non-200 so chatCore's error path + combo
      // fallback engage. Nothing was streamed yet, so nothing is lost.
      try { await reader.cancel(); } catch { /* already closed */ }
      return businessEnvelopeResponse(env);
    }
  }

  // Normal flow (or stream already ended): re-emit everything consumed, then
  // continue — watching for mid-stream envelopes.
  let buffer = consumed;
  let doneEmitted = false;
  let contentFlowed = false;

  const processLine = (line, controller) => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed || doneEmitted) return;
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]") {
      controller.enqueue(encoder.encode(SSE_DONE));
      doneEmitted = true;
      return;
    }
    let parsed = null;
    try { parsed = JSON.parse(data); } catch { return; }

    const env = classifyBusinessEnvelope(parsed);
    if (env) {
      // Mid-stream refusal — content already flowed (or the first frame was a
      // plain chunk), so no fallback can reclaim it. Graceful degradation:
      // honest visible error chunk + clean [DONE].
      const status = businessCodeToHttpStatus(env.code);
      const label = businessCodeLabel(env.code);
      const message = `codebuddy ${label} (${env.code})${env.msg ? `: ${String(env.msg).slice(0, 160)}` : ""}`;
      const errChunk = JSON.stringify({
        id: `codebuddy-error-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model || "codebuddy",
        choices: [{ index: 0, delta: { content: `\n[codebuddy error ${status}: ${message}]` }, finish_reason: "stop" }],
      });
      controller.enqueue(encoder.encode(`data: ${errChunk}\n\n`));
      controller.enqueue(encoder.encode(SSE_DONE));
      doneEmitted = true;
      return;
    }

    contentFlowed = true;
    const sanitized = data.replace(/\r?\n/g, "");
    controller.enqueue(encoder.encode(`data: ${sanitized}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Re-process the peeked frame first (it was consumed but not emitted).
        if (peekedFrame !== null) {
          const firstData = JSON.stringify(peekedFrame).replace(/\r?\n/g, "");
          if (!classifyBusinessEnvelope(peekedFrame)) {
            contentFlowed = true;
            controller.enqueue(encoder.encode(`data: ${firstData}\n\n`));
          }
        }
        // Drain what the peek already buffered.
        let nlSeed;
        while ((nlSeed = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlSeed);
          buffer = buffer.slice(nlSeed + 1);
          processLine(line, controller);
          if (doneEmitted) {
            try { await reader.cancel(); } catch { /* closed */ }
            controller.close();
            return;
          }
        }
        if (streamEnded) {
          buffer += decoder.decode();
          if (buffer.trim().length > 0) processLine(buffer, controller);
          buffer = "";
        }

        while (!doneEmitted && !streamEnded) {
          let read;
          try { read = await reader.read(); } catch { break; }
          if (read.done) {
            buffer += decoder.decode();
            if (buffer.trim().length > 0) processLine(buffer, controller);
            buffer = "";
            break;
          }
          buffer += decoder.decode(read.value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            processLine(line, controller);
            if (doneEmitted) {
              try { await reader.cancel(); } catch { /* closed */ }
              controller.close();
              return;
            }
          }
        }
      } catch {
        // fall through to terminal [DONE] + close
      } finally {
        if (!doneEmitted) {
          try {
            controller.enqueue(encoder.encode(SSE_DONE));
            doneEmitted = true;
          } catch { /* already closed */ }
        }
        try { controller.close(); } catch { /* already closed */ }
        try { await reader.cancel(); } catch { /* closed */ }
      }
    },
    cancel() {
      return reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

// ── system-prompt desensitization (codebuffy sanitize.ts port) ─────────────

const REPLACEMENTS = [
  // Claude Code injects tracking key-value lines INTO the system text —
  // these survive word-level replacement, so drop the lines outright.
  [/^\s*x-[a-z0-9-]+-billing-header:\s*.*$/gim, ""],
  [/\bcc_(?:version|entrypoint)=[^\s;]*/gi, "cli"],
  [/claude[ -]?code/gi, "AgentCLI"],
  [/\bclaude\b/gi, "the assistant"],
  [/\banthropic\b/gi, "the provider"],
  [/\bsonnet\b/gi, "mid-tier model"],
  [/\bopus\b/gi, "large model"],
  [/\bhaiku\b/gi, "fast model"],
  // The live environment block (Current branch / Git user / Status) is what
  // upstream actually fingerprints — drop the lines, keep the rest.
  [/^\s*Current branch:.*$/gim, ""],
  [/^\s*Main branch \(you will usually use this for PRs\):.*$/gim, ""],
  [/^\s*Git (?:user|email):.*$/gim, ""],
  [/^Status:\n(?:[ MAD?!]{1,2} .*\n?)*^$/gim, ""],
  [/\n{3,}/g, "\n\n"],
];

/** Substitute competitor-brand signals in one system text (never user content). */
export function sanitizeCodeBuddySystemText(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ── per-credential circuit breaker (codebuffy breaker.ts port) ─────────────

const BREAKER_THRESHOLD = 5;      // consecutive terminal failures to open
const BREAKER_RESET_MS = 60_000;  // open-window before the half-open probe

// key -> { failures, openUntil, probeInFlight }
const breakers = new Map();

function breakerFor(key) {
  let b = breakers.get(key);
  if (!b) {
    b = { failures: 0, openUntil: 0, probeInFlight: false };
    breakers.set(key, b);
  }
  return b;
}

/** Admit a request? false = breaker open (surface synthetic 429). */
export function breakerTryAdmit(key) {
  const b = breakerFor(key);
  const now = Date.now();
  if (b.openUntil <= now) return true; // closed (or recovered)
  // Half-open: exactly one probe may pass while the window runs.
  if (!b.probeInFlight) {
    b.probeInFlight = true;
    return true;
  }
  return false;
}

/** Record a terminal failure — opens the breaker at the threshold. */
export function breakerRecordFailure(key) {
  const b = breakerFor(key);
  b.failures += 1;
  b.probeInFlight = false;
  if (b.failures >= BREAKER_THRESHOLD) {
    b.openUntil = Date.now() + BREAKER_RESET_MS;
  }
}

/** Record a success — closes the breaker. */
export function breakerRecordSuccess(key) {
  const b = breakerFor(key);
  b.failures = 0;
  b.openUntil = 0;
  b.probeInFlight = false;
}

// ── one-shot token recovery (codebuffy refresh.ts port) ─────────────────────

/** Parse a flexible expiry field (absolute ms, absolute s, or relative s). */
function expiryToMs(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return undefined;
  // < 1e11 reads as seconds (relative or epoch-seconds) — project forward.
  if (n < 1e11) return Date.now() + n * 1000;
  return n;
}

/**
 * One-shot refresh: POST /v2/plugin/auth/token/refresh with the current
 * (possibly expired) token + X-Refresh-Token. Returns Vela-shaped
 * { accessToken, refreshToken?, expiresIn? } or null on any failure — the
 * gate stays honest either way.
 */
export async function refreshCodeBuddyToken(credentials, { refreshUrl, userAgent, fetchFn = null, timeoutMs = 20_000 } = {}) {
  const accessToken = credentials?.accessToken;
  const refreshToken = credentials?.refreshToken;
  if (!refreshUrl || !accessToken || !refreshToken) return null;

  // One-shot guard: never refresh-storm a credential.
  const psd = credentials?.providerSpecificData?.codebuddy || {};
  const lastAttempt = Number(psd.lastRefreshAttemptAt) || 0;
  if (Date.now() - lastAttempt < 60_000) return null;
  try {
    if (credentials.providerSpecificData) {
      credentials.providerSpecificData.codebuddy = { ...psd, lastRefreshAttemptAt: Date.now() };
    }
  } catch { /* stamp is best-effort */ }

  const doFetch = fetchFn || (await import("../../utils/proxyFetch.js")).proxyAwareFetch;
  let res = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("refresh timeout")), timeoutMs);
    try {
      res = await doFetch(refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Refresh-Token": refreshToken,
          "X-Auth-Refresh-Source": "plugin",
          "X-Product": "SaaS",
          ...(userAgent ? { "User-Agent": userAgent } : {}),
        },
        body: JSON.stringify({}),
        signal: ctrl.signal,
      }, null);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
  if (!res || !res.ok) return null;

  let envelope = null;
  try { envelope = JSON.parse(await res.text()); } catch { return null; }
  if (!envelope || typeof envelope !== "object") return null;
  if (typeof envelope.code === "number" && envelope.code !== 0) return null;

  const data = envelope.data && typeof envelope.data === "object" ? envelope.data : envelope;
  const newAccessToken = data.accessToken ?? data.access_token ?? data.token;
  if (typeof newAccessToken !== "string" || !newAccessToken) return null;

  const newRefreshToken = data.refreshToken ?? data.refresh_token ?? data.refreshTokenNew ?? refreshToken;
  const expiresAtMs = expiryToMs(data.expiresAt ?? data.expires_at ?? data.expireAt)
    ?? expiryToMs(data.expiresIn ?? data.expires_in ?? data.expires_in_seconds);
  const expiresIn = expiresAtMs ? Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000)) : undefined;

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn };
}

/** Test hooks. */
export const __test__ = {
  resetBreakers: () => breakers.clear(),
  BREAKER_THRESHOLD,
  BREAKER_RESET_MS,
};
