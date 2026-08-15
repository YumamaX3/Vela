/**
 * FreebuffExecutor — Codebuff free tier wire ceremony.
 *
 * Every chat request rides a four-step ritual:
 *   1. ensure a model-locked session  (freebuffSession.js — claim burns quota)
 *   2. register an agent run          (POST /api/v1/agent-runs START → runId)
 *   3. forge the body as the LAST mutation before fetch:
 *      - byte-exact "You are Buffy…" system marker (inject-or-repair)
 *      - end_turn tool appended when the client sent tools (else 404 gate)
 *      - TOP-LEVEL codebuff_metadata { run_id, client_id, cost_mode:"free" }
 *      - reasoning_effort/reasoning stripped (server owns effort; 400 otherwise)
 *   4. chat POST with pinned User-Agent (403 free_mode_cli_required otherwise)
 *
 * Gates: 409/410/428 stale-session codes reclaim ONCE; model_locked never
 * reclaims (it would burn a unit on the wrong account); 429 → parseError
 * extracts + clamps resetAt for the Pacific-midnight lockout; 401 drops the
 * session and demands re-login (the authToken has no refresh path).
 *
 * execute() is a FULL override (the forge must run after chatCore's savers),
 * but it preserves BaseExecutor's mechanics: connect timeout via
 * AbortSignal.any, merged retryConfig/resolveRetryEntry, 502 network-error
 * mapping, and client-abort propagation. A divergence test pins this.
 */
import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";
import {
  DEFAULT_RETRY_CONFIG,
  resolveRetryEntry,
  FETCH_CONNECT_TIMEOUT_MS,
} from "../config/runtimeConfig.js";
import {
  FREEBUFF_CHAT_URL,
  FREEBUFF_RUNS_URL,
  FREEBUFF_USER_AGENT,
  FREEBUFF_SYSTEM_MARKER,
  FREEBUFF_END_TURN_TOOL,
  FREEBUFF_MODEL_AGENT_IDS,
  FREEBUFF_FALLBACK_AGENT_ID,
} from "../config/freebuff.js";
import {
  ensureSession,
  claimSession,
  clearSession,
  classifyGate,
  clampFreebuffResetMs,
  getPersistedSession,
} from "../services/freebuffSession.js";

export class FreebuffGateError extends Error {
  constructor(message, status, gate) {
    super(message);
    this.name = "FreebuffGateError";
    this.status = status;
    this.gate = gate;
  }
}

// Whitelisted-scalar parsing only — raw upstream JSON is never spread.
function extractScalars(bodyText) {
  const out = { code: null, message: null, resetAt: null };
  if (typeof bodyText !== "string" || !bodyText) return out;
  try {
    const json = JSON.parse(bodyText);
    const src = json && typeof json === "object" && json.error && typeof json.error === "object" ? json.error : json;
    if (src && typeof src === "object") {
      if (typeof src.code === "string") out.code = src.code;
      else if (typeof src.status === "string") out.code = src.status;
      if (typeof src.message === "string") out.message = src.message;
      const raw = src.resetAt ?? src.reset_at ?? src.resets_at ?? src.resetAtMs;
      const parsed = typeof raw === "string" ? Date.parse(raw) : Number(raw);
      if (Number.isFinite(parsed)) out.resetAt = parsed;
    }
  } catch { /* not JSON — empty scalars */ }
  return out;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Idempotent marker forge: the FIRST system message must byte-exactly OPEN
 * with the marker. Handles string content and OpenAI-source array content
 * (arrays are joined to a string — the gate compares serialized text).
 */
export function injectFreebuffMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ...body, messages: [{ role: "system", content: FREEBUFF_SYSTEM_MARKER }, ...(messages || [])] };
  }
  const next = [...messages];
  const first = next[0];
  if (first?.role === "system") {
    const text = textOf(first.content);
    if (text.startsWith(FREEBUFF_SYSTEM_MARKER)) return body; // already forged
    next[0] = { ...first, content: `${FREEBUFF_SYSTEM_MARKER}\n\n${text}`.trimEnd() };
    return { ...body, messages: next };
  }
  next.unshift({ role: "system", content: FREEBUFF_SYSTEM_MARKER });
  return { ...body, messages: next };
}

function injectEndTurnTool(body) {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return body;
  const has = body.tools.some((t) => t?.function?.name === "end_turn" || t?.name === "end_turn");
  if (has) return body;
  return { ...body, tools: [...body.tools, FREEBUFF_END_TURN_TOOL] };
}

function forgeBody(model, body, session, runId, clientId) {
  let forged = injectFreebuffMarker(body);
  forged = injectEndTurnTool(forged);
  delete forged.reasoning_effort;
  delete forged.reasoning;
  // Top-level — NOT nested under a wrapper object (400 "No runId found" otherwise).
  forged.codebuff_metadata = {
    run_id: runId,
    client_id: clientId,
    trace_session_id: session.instanceId,
    freebuff_instance_id: session.instanceId,
    cost_mode: "free",
  };
  forged.provider = { allow_fallbacks: false };
  return forged;
}

function syntheticResponse(status, bodyObj) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS["freebuff"]);
  }

  buildUrl() {
    return FREEBUFF_CHAT_URL;
  }

  buildHeaders(credentials, stream = true, url = null, model = null) {
    const headers = super.buildHeaders(credentials, stream);
    headers["User-Agent"] = FREEBUFF_USER_AGENT; // pinned — never overridden by transport drift
    if (model) headers["x-freebuff-model"] = model;
    const session = getPersistedSession(credentials);
    if (session?.instanceId) headers["x-freebuff-instance-id"] = session.instanceId;
    return headers;
  }

  // The authToken has NO refresh path — return null immediately so chatCore's
  // refresh loop ends fast instead of burning retries against nothing.
  async refreshCredentials() {
    return null;
  }

  clientIdFor(credentials) {
    return credentials?.providerSpecificData?.freebuff?.fingerprintId
      || `vela-${crypto.randomUUID()}`;
  }

  async startRun(agentId, credentials, proxyOptions, log) {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      "User-Agent": FREEBUFF_USER_AGENT,
    };
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const signal = AbortSignal.timeout(20000);
        const res = await proxyAwareFetch(FREEBUFF_RUNS_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "START", agentId, ancestorRunIds: [] }),
          signal,
        }, proxyOptions);
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          const runId = json?.runId || json?.id || json?.data?.runId;
          if (runId) return runId;
          lastErr = new Error("agent-run START returned no runId");
        } else {
          lastErr = new Error(`agent-run START failed: ${res.status}`);
        }
      } catch (err) {
        lastErr = err;
      }
    }
    log?.warn?.("FREEBUFF", `agent-run START failed twice for ${agentId}: ${lastErr?.message}`);
    throw new FreebuffGateError(`freebuff: agent-run registration failed (${lastErr?.message || "unknown"})`, 502, { kind: "run_failed" });
  }

  finishRun(runId, status, credentials, proxyOptions) {
    if (!runId) return;
    // Best-effort, fire-and-forget — never blocks, never throws.
    (async () => {
      try {
        await proxyAwareFetch(FREEBUFF_RUNS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credentials.accessToken}`,
            "User-Agent": FREEBUFF_USER_AGENT,
          },
          body: JSON.stringify({ action: "FINISH", runId, status }),
          signal: AbortSignal.timeout(10000),
        }, proxyOptions);
      } catch { /* best-effort */ }
    })();
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl(model, stream, 0, credentials);
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const retryAttempts = { count: 0 };

    const tryRetryStatus = async (status, reason) => {
      const { attempts, delayMs } = resolveRetryEntry(retryConfig[status]);
      if (attempts <= 0 || retryAttempts.count >= attempts) return false;
      retryAttempts.count++;
      log?.debug?.("RETRY", `freebuff ${reason} retry ${retryAttempts.count}/${attempts} after ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
      return true;
    };

    // ── the ceremony ────────────────────────────────────────────────────────
    let session, runId;
    try {
      session = await ensureSession(credentials, model, proxyOptions, signal, log);
      const agentId0 = FREEBUFF_MODEL_AGENT_IDS[model] || session.agentId || FREEBUFF_FALLBACK_AGENT_ID;
      runId = await this.startRun(agentId0, credentials, proxyOptions, log);
    } catch (err) {
      // Claim refused with a structured gate (model_locked / blocked / quota) —
      // surface it as a gate-shaped response so chat.js locks + falls back
      // correctly (a bare throw would collapse to a generic 502).
      const gate = err?.freebuffGate;
      if (gate && ["model_locked", "blocked", "quota"].includes(gate.kind)) {
        const status = gate.kind === "model_locked" ? 409 : gate.kind === "quota" ? 429 : 403;
        const payload = {
          error: {
            message: `freebuff: ${gate.code || "claim_failed"}${gate.message ? ` — ${gate.message.slice(0, 160)}` : ""}`,
            type: gate.kind === "quota" ? "rate_limit_error" : gate.kind === "blocked" ? "permission_error" : "rate_limit_error",
            code: gate.code || gate.kind,
            ...(gate.kind === "quota" && Number.isFinite(gate.resetAt)
              ? { resetAt: clampFreebuffResetMs(gate.resetAt) }
              : {}),
          },
        };
        return {
          response: syntheticResponse(status, payload),
          url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: body,
        };
      }
      throw err;
    }
    const agentId = FREEBUFF_MODEL_AGENT_IDS[model] || session.agentId || FREEBUFF_FALLBACK_AGENT_ID;
    let reclaimedOnce = false;

    const doFetch = async () => {
      const forged = forgeBody(model, body, session, runId, this.clientIdFor(credentials));
      const headers = this.buildHeaders(credentials, stream, url, model);

      // Base mechanics: connect timeout + merged abort signal
      const connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        const bodyStr = JSON.stringify(forged);
        const t0 = Date.now();
        dbg("FETCH", `FREEBUFF → ${url} | body=${bodyStr.length}B | model=${model} | run=${runId}`);
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: mergedSignal,
        }, proxyOptions);
        clearTimeout(connectTimer);
        dbg("FETCH", `FREEBUFF ← ${response.status} | ttft=${Date.now() - t0}ms`);
        return { response, forged };
      } catch (error) {
        clearTimeout(connectTimer);
        const isConnectTimeout = connectCtrl.signal.aborted && error.name === "AbortError";
        if (error.name === "AbortError" && !isConnectTimeout) throw error; // client abort — never retried
        // Base mechanic: network errors map to the 502 retry entry
        if (await tryRetryStatus(502, `network "${error.message}"`)) return doFetch();
        throw error;
      }
    };

    try {
      while (true) {
        const { response, forged } = await doFetch();

        // ── session-stale gates: reclaim ONCE, then surface ────────────────
        if ([409, 410, 428].includes(response.status)) {
          const text = await response.text().catch(() => "");
          const gate = classifyGate(response.status, text);

          if (gate.kind === "model_locked") {
            this.finishRun(runId, "cancelled", credentials, proxyOptions);
            return {
              response: syntheticResponse(409, {
                error: {
                  message: "freebuff: model_locked — this account's session is locked to another model (wait for it to expire, or use another account)",
                  type: "rate_limit_error",
                  code: "model_locked",
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }

          if ((gate.kind === "reclaimable" || gate.kind === "stale_unknown") && !reclaimedOnce) {
            reclaimedOnce = true;
            log?.debug?.("FREEBUFF", `session stale (${gate.code || response.status}) — reclaiming once`);
            this.finishRun(runId, "cancelled", credentials, proxyOptions);
            await clearSession(credentials, gate.code || "stale");
            session = await claimSession(credentials, model, proxyOptions, signal);
            runId = await this.startRun(agentId, credentials, proxyOptions, log);
            continue; // retry the chat with the fresh session — exactly once
          }

          // second stale gate (or unknown-kind non-stale) → surface upstream
          this.finishRun(runId, "failed", credentials, proxyOptions);
          return {
            response: syntheticResponse(response.status, extractScalars(text)),
            url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
          };
        }

        // ── auth death: no refresh path — drop session, demand re-login ────
        if (response.status === 401) {
          const text = await response.text().catch(() => "");
          this.finishRun(runId, "cancelled", credentials, proxyOptions);
          await clearSession(credentials, "auth_expired");
          return {
            response: syntheticResponse(401, {
              error: {
                message: "freebuff: auth token expired — re-login required in the dashboard (Freebuff tokens have no refresh path)",
                type: "authentication_error",
                code: "auth_expired",
                ...(extractScalars(text).message ? {} : {}),
              },
            }),
            url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
          };
        }

        // ── daily quota: surface with resetAt for the Pacific-midnight lock ─
        if (response.status === 429) {
          const text = await response.text().catch(() => "");
          const { resetAt, message } = extractScalars(text);
          this.finishRun(runId, "failed", credentials, proxyOptions);
          const resetsAtMs = clampFreebuffResetMs(resetAt);
          return {
            response: syntheticResponse(429, {
              error: {
                message: `freebuff: daily session quota exhausted — resets at ${new Date(resetsAtMs).toISOString()}${message ? ` (${message.slice(0, 120)})` : ""}`,
                type: "rate_limit_error",
                code: "quota_exhausted",
                resetAt: resetsAtMs,
              },
            }),
            url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
          };
        }

        // ── 403 CLI gate: UA/marker drift hint ─────────────────────────────
        if (response.status === 403) {
          const text = await response.text().catch(() => "");
          const { code, message } = extractScalars(text);
          this.finishRun(runId, "failed", credentials, proxyOptions);
          const hint = code === "free_mode_cli_required"
            ? "freebuff: free_mode_cli_required — the CLI gate rejected this request (User-Agent or marker drift; see open-sse/config/freebuff.js)"
            : `freebuff: forbidden${code ? ` (${code})` : ""}${message ? ` — ${message.slice(0, 120)}` : ""}`;
          return {
            response: syntheticResponse(403, { error: { message: hint, type: "permission_error", code: code || "forbidden" } }),
            url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
          };
        }

        // ── transient 5xx: base retry mechanic ─────────────────────────────
        if ([502, 503, 504].includes(response.status)) {
          if (await tryRetryStatus(response.status, `status ${response.status}`)) continue;
          this.finishRun(runId, "failed", credentials, proxyOptions);
          return { response, url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged };
        }

        // ── success or any other status → hand to chatCore ─────────────────
        this.finishRun(runId, response.ok ? "completed" : "failed", credentials, proxyOptions);
        return { response, url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged };
      }
    } catch (error) {
      this.finishRun(runId, "cancelled", credentials, proxyOptions);
      throw error;
    }
  }

  parseError(response, bodyText) {
    const status = response.status;
    const { code, message, resetAt } = extractScalars(bodyText);

    if (status === 429) {
      const resetsAtMs = clampFreebuffResetMs(resetAt);
      return {
        status,
        message: `freebuff: daily session quota exhausted — resets at ${new Date(resetsAtMs).toISOString()}`,
        resetsAtMs,
      };
    }
    if (status === 401) {
      return {
        status,
        message: "freebuff: auth token expired — re-login required in the dashboard (no token refresh exists)",
      };
    }
    if (status === 409 && code === "model_locked") {
      return {
        status,
        message: "freebuff: model_locked — this account's session is locked to another model",
      };
    }
    if (message) return { status, message: `freebuff: ${message.slice(0, 200)}` };
    return super.parseError(response, bodyText);
  }
}

export default FreebuffExecutor;
