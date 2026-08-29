/**
 * FreebuffExecutor — Codebuff free tier wire ceremony.
 *
 * Every chat request rides a four-step ritual:
 *   1. ensure a model-locked session  (freebuffSession.js — claim burns quota)
 *   2. register an agent run          (POST /api/v1/agent-runs START → runId)
 *   3. forge the body as the LAST mutation before fetch:
 *      - canonical "You are Buffy…" opening (base2/base3 marker, five-gate check)
 *      - end_turn tool appended when the client sent tools (else 404 gate)
 *      - TOP-LEVEL codebuff_metadata { run_id, client_id, trace_session_id,
 *        freebuff_instance_id, cost_mode:"free", llm_step_number }
 *      - stop sentinel '"cb_easp"' (JSON-encoded) when the client sent none
 *      - provider { data_collection:"deny", allow_fallbacks:false }
 *      - reasoning_effort/reasoning stripped (server owns effort; 400 otherwise)
 *   4. chat POST with the pinned ai-sdk User-Agent (403 free_mode_cli_required
 *      otherwise — and the ai-sdk UA rides the chat POST ONLY)
 *
 * The client_id is minted ONCE PER RUN — 13-char base36, SDK-faithful shape,
 * repeated on every chat call of the run. A per-call draw fans one run_id
 * across N client ids, which upstream refuses as free_mode_run_fanout (a
 * ban-grade sweep signal).
 *
 * Gate taxonomy (reference freebuff-proxy ratelimit.go): banned /
 * country_blocked / run_fanout / invalid_agent_model / capacity_deferred
 * (retry in place) / load_shedding / peak_hours / ip_capped / waiting_room_* /
 * session_limit_reached / session_superseded (terminal — never auto-reacquire)
 * / limited_ip / daily quota (Pacific-midnight lock) / opaque 429 (bounded).
 * Minutes-scale refusals rotate the account for a bounded cooldown; only a
 * genuine daily cap locks to Pacific midnight.
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
  FREEBUFF_BUN_USER_AGENT,
  FREEBUFF_SYSTEM_MARKER,
  FREEBUFF_SYSTEM_MARKER_BASE3,
  FREEBUFF_GATE_OPENINGS,
  FREEBUFF_END_TURN_TOOL,
  FREEBUFF_STOP_SENTINEL,
  FREEBUFF_MODEL_AGENT_IDS,
  FREEBUFF_FALLBACK_AGENT_ID,
  FREEBUFF_PAUSED_MODELS,
  FREEBUFF_COOLDOWNS,
  FREEBUFF_MAX_COOLDOWN_MS,
  FREEBUFF_CAPACITY_DEFERRED,
  FREEBUFF_REPICK_CODES,
  FREEBUFF_REPICK_MAX_ATTEMPTS,
  FREEBUFF_REPICK_BUDGET_MS,
} from "../config/freebuff.js";
import {
  ensureSession,
  claimSession,
  clearSession,
  classifyGate,
  clampFreebuffResetMs,
  clampFreebuffCooldownMs,
  getPersistedSession,
  stampWaitingRoomRequired,
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
  const out = { code: null, message: null, resetAt: null, retryAfterMs: null, resumesAt: null };
  if (typeof bodyText !== "string" || !bodyText) return out;
  try {
    const json = JSON.parse(bodyText);
    const src = json && typeof json === "object" && json.error && typeof json.error === "object" ? json.error : json;
    if (src && typeof src === "object") {
      if (typeof src.code === "string") out.code = src.code;
      else if (typeof src.status === "string") out.code = src.status;
      if (typeof src.message === "string") out.message = src.message;
      const epoch = (raw) => {
        const parsed = typeof raw === "string" ? Date.parse(raw) : Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
      };
      out.resetAt = epoch(src.resetAt ?? src.reset_at ?? src.resets_at ?? src.resetAtMs);
      out.resumesAt = epoch(src.resumes_at ?? src.resumesAt);
      const rawRetry = src.retryAfterMs ?? src.retry_after_ms;
      if (rawRetry != null) {
        const n = Number(rawRetry);
        if (Number.isFinite(n) && n > 0) out.retryAfterMs = n;
      }
    }
  } catch { /* not JSON — empty scalars */ }
  return out;
}

/**
 * SDK-faithful client_id: 13-char base36, the shape of the CLI's
 * Math.random().toString(36).substring(2, 15). Minted ONCE per run and
 * repeated on every chat call — never the sess:/run:-prefixed forms, never a
 * per-call uuid (upstream fingerprints both as proxy fanout).
 */
export function generateCliClientId() {
  const buf = crypto.randomBytes(16);
  let n = BigInt(0);
  for (const b of buf) n = (n << BigInt(8)) | BigInt(b);
  let id = (n % BigInt(36) ** BigInt(13)).toString(36);
  while (id.length < 13) id = `0${id}`;
  return id;
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

/** The free-mode gate is any-of-five — a content already opening canonically stays. */
function hasCanonicalOpening(content) {
  const trimmed = content.replace(/^[\s]+/, "");
  return FREEBUFF_GATE_OPENINGS.some((opening) => trimmed.startsWith(opening));
}

/**
 * Idempotent marker forge: the FIRST system message must byte-exactly OPEN
 * with the run's canonical identity. base3 roots speak the base3 sentence;
 * everything else keeps base2's. Handles string content and OpenAI-source
 * array content (arrays are joined to a string — the gate compares serialized
 * text). A message already opening with ANY of the five canonical identities
 * is left untouched regardless of marker choice.
 */
export function injectFreebuffMarker(body, agentId = "") {
  const marker = String(agentId || "").startsWith("base3")
    ? FREEBUFF_SYSTEM_MARKER_BASE3
    : FREEBUFF_SYSTEM_MARKER;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ...body, messages: [{ role: "system", content: marker }, ...(messages || [])] };
  }
  const next = [...messages];
  const first = next[0];
  if (first?.role === "system") {
    const text = textOf(first.content);
    if (hasCanonicalOpening(text)) return body; // already canonical — the gate is any-of-five
    next[0] = { ...first, content: `${marker}\n\n${text}`.trimEnd() };
    return { ...body, messages: next };
  }
  next.unshift({ role: "system", content: marker });
  return { ...body, messages: next };
}

function injectEndTurnTool(body) {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return body;
  const has = body.tools.some((t) => t?.function?.name === "end_turn" || t?.name === "end_turn");
  if (has) return body;
  return { ...body, tools: [...body.tools, FREEBUFF_END_TURN_TOOL] };
}

function forgeBody(model, body, session, runId, clientId, traceSessionId) {
  let forged = injectFreebuffMarker(body, session.agentId);
  forged = injectEndTurnTool(forged);
  delete forged.reasoning_effort;
  delete forged.reasoning;
  // The CLI's global stop sequence is the JSON-ENCODED token — injected only
  // when the client sent no stop of its own.
  if (forged.stop === undefined) forged.stop = [FREEBUFF_STOP_SENTINEL];
  // Top-level — NOT nested under a wrapper object (400 "No runId found" otherwise).
  // client_id + trace_session_id are per-RUN identities; freebuff_instance_id
  // is the per-session one. llm_step_number rides the wire as a string.
  forged.codebuff_metadata = {
    run_id: runId,
    client_id: clientId,
    trace_session_id: traceSessionId,
    freebuff_instance_id: session.instanceId,
    cost_mode: "free",
    llm_step_number: "1",
  };
  forged.provider = { data_collection: "deny", allow_fallbacks: false };
  return forged;
}

function syntheticResponse(status, bodyObj) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build the bounded-cooldown 429-style result for minutes-scale refusals. */
function boundedCooldownResult(executor, url, credentials, stream, model, forged, gate, cooldownMs, runId, activeProxyOptions) {
  const cooldown = clampFreebuffCooldownMs(cooldownMs);
  executor.finishRun(runId, "failed", credentials, activeProxyOptions);
  const payload = {
    error: {
      message: `freebuff: ${gate.code || gate.kind}${gate.message ? ` — ${String(gate.message).slice(0, 160)}` : ""}`,
      type: "rate_limit_error",
      code: gate.code || gate.kind,
      retryAfterMs: cooldown,
    },
  };
  return {
    response: syntheticResponse(429, payload),
    url, headers: executor.buildHeaders(credentials, stream, url, model), transformedBody: forged,
  };
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
    headers["User-Agent"] = FREEBUFF_USER_AGENT; // pinned ai-sdk UA — chat ONLY, never overridden
    // The chat POST carries NO x-freebuff-model / x-freebuff-instance-id
    // headers (reference #106): the model and instance id ride only in the
    // body metadata (forgeBody). Vela's old header pair is a fingerprint
    // deviation — removed in the ascension.
    return headers;
  }

  // The authToken has NO refresh path — return null immediately so chatCore's
  // refresh loop ends fast instead of burning retries against nothing.
  async refreshCredentials() {
    return null;
  }

  async startRun(agentId, credentials, proxyOptions, log) {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      // G5 UA scoping: agent-runs carry the plain Bun UA, not the chat UA.
      "User-Agent": FREEBUFF_BUN_USER_AGENT,
      // Dual-auth parity (current vendor wire): agent-runs POSTs carry BOTH
      // Authorization and x-codebuff-api-key — the same raw token.
      "x-codebuff-api-key": credentials.accessToken,
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
            "User-Agent": FREEBUFF_BUN_USER_AGENT,
            "x-codebuff-api-key": credentials.accessToken,
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

    // ── paused-model refusal — BEFORE any session burn ─────────────────────
    // Upstream recognizes paused ids but refuses them at admission; serving
    // them would burn a doomed admission per request. Honest copy names the
    // replacement (registry.go WithdrawnModelMessage).
    const replacement = FREEBUFF_PAUSED_MODELS[model];
    if (replacement) {
      const display = (id) => id.split("/")[1] || id;
      return {
        response: syntheticResponse(400, {
          error: {
            message: `freebuff: ${display(model)} is no longer available in Freebuff. We recommend using ${display(replacement)} instead.`,
            type: "invalid_request_error",
            code: "model_paused",
          },
        }),
        url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: body,
      };
    }

    // ── per-run identities (minted ONCE, repeated on every retry) ──────────
    const clientId = generateCliClientId();
    const traceSessionId = crypto.randomUUID();

    // ── the ceremony ────────────────────────────────────────────────────────
    let session, runId, agentId, currentProxyOptions = proxyOptions || {};
    let claimedOnce = false;

    while (!claimedOnce || true) {
      try {
        session = await ensureSession(credentials, model, currentProxyOptions, signal, log);
        agentId = FREEBUFF_MODEL_AGENT_IDS[model] || session.agentId || FREEBUFF_FALLBACK_AGENT_ID;
        runId = await this.startRun(agentId, credentials, currentProxyOptions, log);
        claimedOnce = true;
      } catch (err) {
        // Claim refused with a structured gate (model_locked / blocked / quota) —
        // surface it as a gate-shaped response so chat.js locks + falls back
        // correctly (a bare throw would collapse to a generic 502).
        const gate = err?.freebuffGate;

        // Egress IP-scoped blocked claims → instant re-pick loop (C16 LOCKED)
        const poolId = credentials?.providerSpecificData?.connectionProxyPoolId;
        if (gate?.kind === "blocked" && FREEBUFF_REPICK_CODES.has(gate.code || "") && poolId) {
          const excludePoolIds = [poolId];
          const { repick } = await import("@/lib/network/proxyFleet.js");
          const result = await repick(model, excludePoolIds, FREEBUFF_REPICK_MAX_ATTEMPTS, FREEBUFF_REPICK_BUDGET_MS);
          if (result) {
            // Rebuild proxyOptions from the new pool's config
            const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy.js");
            const resolved = await resolveConnectionProxyConfig({ proxyPoolId: result.poolId });
            currentProxyOptions = resolved;
            log?.debug?.("FREEBUFF", `re-pick: ${poolId} → ${result.poolId}, rebuilding proxy options`);
            // Restart loop with new proxy options
            continue;
          } else {
            log?.warn?.("FREEBUFF", `re-pick exhausted (${excludePoolIds.join(",")}) — surface blocked claim`);
            const status = 429;
            const payload = {
              error: {
                message: `freebuff: egress blocked (re-pick exhausted)`,
                type: "rate_limit_error",
                code: "ip_capped_exhausted",
              },
            };
            return {
              response: syntheticResponse(status, payload),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: body,
            };
          }
        }

        // Bounded claim refusals (taxonomy kinds that arrive via the claim POST
        // under load) surface as 429 with their bounded window — same shape the
        // chat loop emits, so auth.js rotates accounts instead of midnight-locking.
        if (gate && ["run_fanout", "invalid_agent_model", "load_shedding", "peak_hours", "bounded_429", "ip_capped"].includes(gate.kind)) {
          const cooldownMs = gate.kind === "load_shedding" ? FREEBUFF_COOLDOWNS.LOAD_SHED_MS
            : gate.kind === "peak_hours" ? FREEBUFF_COOLDOWNS.PEAK_HOURS_MS
            : gate.kind === "run_fanout" ? FREEBUFF_COOLDOWNS.RUN_FANOUT_MS
            : gate.kind === "invalid_agent_model" ? FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS
            : gate.kind === "ip_capped" ? gate.retryAfterMs
            : FREEBUFF_COOLDOWNS.OPAQUE_429_MS;
          return {
            response: syntheticResponse(429, {
              error: {
                message: `freebuff: ${gate.code || gate.kind}${gate.message ? ` — ${String(gate.message).slice(0, 160)}` : ""}`,
                type: "rate_limit_error",
                code: gate.code || gate.kind,
                retryAfterMs: clampFreebuffCooldownMs(cooldownMs),
              },
            }),
            url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: body,
          };
        }

        if (gate && ["model_locked", "blocked", "quota", "daily_quota"].includes(gate.kind)) {
          const status = gate.kind === "model_locked" ? 409 : (gate.kind === "quota" || gate.kind === "daily_quota") ? 429 : 403;
          const payload = {
            error: {
              message: `freebuff: ${gate.code || "claim_failed"}${gate.message ? ` — ${gate.message.slice(0, 160)}` : ""}`,
              type: gate.kind === "blocked" ? "permission_error" : "rate_limit_error",
              code: gate.code || gate.kind,
              ...((gate.kind === "quota" || gate.kind === "daily_quota") && Number.isFinite(gate.resetAt)
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
      break; // Successfully claimed, exit claim loop
    }
    let reclaimedOnce = false;
    let capacityDeferredAttempts = 0;

    const doFetch = async () => {
      const forged = forgeBody(model, body, session, runId, clientId, traceSessionId);
      const headers = this.buildHeaders(credentials, stream, url, model);

      // Base mechanics: connect timeout + merged abort signal
      const connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        const bodyStr = JSON.stringify(forged);
        const t0 = Date.now();
        dbg("FETCH", `FREEBUFF → ${url} | body=${bodyStr.length}B | model=${model} | run=${runId} | client=${clientId}`);
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: mergedSignal,
        }, currentProxyOptions);
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

        // ── capacity-deferred: retry IN PLACE against the same session ─────
        // The free tier's transient capacity queue ("your request will be
        // retried automatically"). Same lease, same session — never a token
        // cooldown, never an invalidation (chat.go #105).
        if (response.status >= 400) {
          const peekText = await response.text().catch(() => "");
          const peekGate = classifyGate(response.status, peekText);
          if (peekGate.kind === "capacity_deferred" && capacityDeferredAttempts < FREEBUFF_CAPACITY_DEFERRED.ATTEMPTS) {
            capacityDeferredAttempts++;
            const waitMs = Math.max(
              FREEBUFF_CAPACITY_DEFERRED.MIN_WAIT_MS,
              Math.min(Number(peekGate.retryAfterMs) || 0, FREEBUFF_CAPACITY_DEFERRED.MAX_WAIT_MS) || FREEBUFF_CAPACITY_DEFERRED.MIN_WAIT_MS,
            );
            log?.debug?.("FREEBUFF", `capacity deferred — retrying in place ${capacityDeferredAttempts}/${FREEBUFF_CAPACITY_DEFERRED.ATTEMPTS} after ${Math.round(waitMs / 1000)}s`);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          // Re-route the drained body through the full taxonomy below.
          const gate = peekGate;
          const text = peekText;

          // ── banned / country_blocked — terminal account fates ─────────────
          if (gate.kind === "banned") {
            this.finishRun(runId, "failed", credentials, proxyOptions);
            // Ban window: the body's validated resumes_at (ceiling-clamped) or
            // the 24h default — NEVER the Pacific-midnight clamp (a ban can
            // span two midnights).
            const untilMs = gate.resetAt && gate.resetAt > Date.now()
              ? Math.min(gate.resetAt, Date.now() + FREEBUFF_MAX_COOLDOWN_MS)
              : Date.now() + FREEBUFF_COOLDOWNS.BAN_MS;
            return {
              response: syntheticResponse(403, {
                error: {
                  // The "resumes at <ISO>" stamp is load-bearing: auth.js's
                  // freebuffBanCooldownMs parses it to lock until the real
                  // resume moment instead of the 24h default.
                  message: `freebuff: account banned — resumes at ${new Date(untilMs).toISOString()}${gate.message ? ` (${String(gate.message).slice(0, 120)})` : ""}`,
                  type: "permission_error",
                  code: "banned",
                  resetsAtMs: untilMs,
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }
          if (gate.kind === "country_blocked") {
            this.finishRun(runId, "failed", credentials, proxyOptions);
            return {
              response: syntheticResponse(403, {
                error: {
                  message: `freebuff: country_blocked${gate.message ? ` — ${String(gate.message).slice(0, 160)}` : ""}`,
                  type: "permission_error",
                  code: "country_blocked",
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }

          // ── bounded cooldowns (never a midnight lock) ─────────────────────
          if (gate.kind === "run_fanout" || gate.kind === "invalid_agent_model") {
            const cooldownMs = gate.kind === "run_fanout" ? FREEBUFF_COOLDOWNS.RUN_FANOUT_MS : FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS;
            return boundedCooldownResult(this, url, credentials, stream, model, forged, gate, cooldownMs, runId, currentProxyOptions);
          }
          if (gate.kind === "load_shedding" || gate.kind === "peak_hours" || gate.kind === "bounded_429" || gate.kind === "ip_capped") {
            const cooldownMs = gate.kind === "load_shedding" ? FREEBUFF_COOLDOWNS.LOAD_SHED_MS
              : gate.kind === "peak_hours" ? FREEBUFF_COOLDOWNS.PEAK_HOURS_MS
              : gate.kind === "ip_capped" ? gate.retryAfterMs
              : FREEBUFF_COOLDOWNS.OPAQUE_429_MS;
            return boundedCooldownResult(this, url, credentials, stream, model, forged, gate, cooldownMs, runId, currentProxyOptions);
          }

          // ── waiting-room family ───────────────────────────────────────────
          if (gate.kind === "waiting_room_required") {
            this.finishRun(runId, "failed", credentials, proxyOptions);
            await stampWaitingRoomRequired(credentials);
            return {
              response: syntheticResponse(428, {
                error: {
                  message: "freebuff: waiting_room_required — the account must complete the waiting-room flow before its next session",
                  type: "rate_limit_error",
                  code: "waiting_room_required",
                  retryAfterMs: clampFreebuffCooldownMs(gate.retryAfterMs) || FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS,
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }
          if (gate.kind === "waiting_room_queued" || gate.kind === "session_limit") {
            // Session row is fine — surface a transient refusal; never invalidate.
            this.finishRun(runId, "failed", credentials, proxyOptions);
            return {
              response: syntheticResponse(gate.kind === "session_limit" ? 409 : 503, {
                error: {
                  message: `freebuff: ${gate.code}${gate.message ? ` — ${String(gate.message).slice(0, 160)}` : ""}`,
                  type: "rate_limit_error",
                  code: gate.code,
                  retryAfterMs: FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS,
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }

          // ── session-stale gates ───────────────────────────────────────────
          if (gate.kind === "superseded") {
            // TERMINAL (endsTheSession:true): another instance took the account.
            // Never auto-reacquire in-request — the next request re-joins fresh.
            this.finishRun(runId, "failed", credentials, proxyOptions);
            await clearSession(credentials, "session_superseded");
            return {
              response: syntheticResponse(409, {
                error: {
                  message: "freebuff: session_superseded — another instance took over this account; the next request will re-join fresh",
                  type: "rate_limit_error",
                  code: "session_superseded",
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }
          if (gate.kind === "limited_ip") {
            // Egress IP cannot serve this model — session stays bound; cool the
            // pairing, not the session.
            this.finishRun(runId, "failed", credentials, proxyOptions);
            return {
              response: syntheticResponse(409, {
                error: {
                  message: `freebuff: limited egress — this IP cannot serve the requested model${gate.message ? ` (${String(gate.message).slice(0, 120)})` : ""}`,
                  type: "rate_limit_error",
                  code: "session_model_mismatch",
                  retryAfterMs: FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS,
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }
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
          if ((gate.kind === "reclaimable" || gate.kind === "stale_unknown") && [409, 410, 428].includes(response.status)) {
            if (!reclaimedOnce) {
              reclaimedOnce = true;
              log?.debug?.("FREEBUFF", `session stale (${gate.code || response.status}) — reclaiming once`);
              this.finishRun(runId, "cancelled", credentials, proxyOptions);
              await clearSession(credentials, gate.code || "stale");
              session = await claimSession(credentials, model, proxyOptions, signal);
              runId = await this.startRun(agentId, credentials, proxyOptions, log);
              continue; // retry the chat with the fresh session — exactly once
            }
            // second stale gate → surface upstream
            this.finishRun(runId, "failed", credentials, proxyOptions);
            return {
              response: syntheticResponse(response.status, { error: { message: `freebuff: ${gate.code || "session_stale"}`, type: "rate_limit_error", code: gate.code || "session_stale" } }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }

          // ── auth death: no refresh path — drop session, demand re-login ────
          if (response.status === 401 || gate.kind === "auth") {
            this.finishRun(runId, "cancelled", credentials, proxyOptions);
            await clearSession(credentials, "auth_expired");
            return {
              response: syntheticResponse(401, {
                error: {
                  message: "freebuff: auth token expired — re-login required in the dashboard (Freebuff tokens have no refresh path)",
                  type: "authentication_error",
                  code: "auth_expired",
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }

          // ── daily quota: surface with resetAt for the Pacific-midnight lock ─
          if (gate.kind === "daily_quota") {
            this.finishRun(runId, "failed", credentials, proxyOptions);
            const resetsAtMs = clampFreebuffResetMs(gate.resetAt);
            return {
              response: syntheticResponse(429, {
                error: {
                  message: `freebuff: daily session quota exhausted — resets at ${new Date(resetsAtMs).toISOString()}${gate.message ? ` (${String(gate.message).slice(0, 120)})` : ""}`,
                  type: "rate_limit_error",
                  code: "quota_exhausted",
                  resetAt: resetsAtMs,
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }

          // ── 403 CLI gate: UA/marker drift hint ─────────────────────────────
          if (response.status === 403 && gate.kind === "cli_required") {
            this.finishRun(runId, "failed", credentials, proxyOptions);
            return {
              response: syntheticResponse(403, {
                error: {
                  message: "freebuff: free_mode_cli_required — the CLI gate rejected this request (User-Agent or marker drift; see open-sse/config/freebuff.js)",
                  type: "permission_error",
                  code: "free_mode_cli_required",
                },
              }),
              url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
            };
          }

          // ── transient 5xx: base retry mechanic ─────────────────────────────
          if ([502, 503, 504].includes(response.status)) {
            if (await tryRetryStatus(response.status, `status ${response.status}`)) continue;
            this.finishRun(runId, "failed", credentials, proxyOptions);
            return { response, url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged };
          }

          // ── any other non-2xx → surface honestly ──────────────────────────
          this.finishRun(runId, "failed", credentials, proxyOptions);
          return {
            response: syntheticResponse(response.status, {
              error: {
                message: `freebuff: ${gate.code || "error"}${gate.message ? ` — ${String(gate.message).slice(0, 160)}` : ""}`,
                type: response.status >= 500 ? "server_error" : "invalid_request_error",
                code: gate.code || String(response.status),
              },
            }),
            url, headers: this.buildHeaders(credentials, stream, url, model), transformedBody: forged,
          };
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
    const gate = classifyGate(status, bodyText);

    if (gate.kind === "daily_quota") {
      const resetsAtMs = clampFreebuffResetMs(gate.resetAt);
      return {
        status,
        message: `freebuff: daily session quota exhausted — resets at ${new Date(resetsAtMs).toISOString()}`,
        resetsAtMs,
      };
    }
    if (gate.kind === "banned") {
      const untilMs = gate.resetAt && gate.resetAt > Date.now()
        ? Math.min(gate.resetAt, Date.now() + FREEBUFF_MAX_COOLDOWN_MS)
        : Date.now() + FREEBUFF_COOLDOWNS.BAN_MS;
      return {
        status,
        message: `freebuff: account banned${gate.message ? ` — ${String(gate.message).slice(0, 120)}` : ""}`,
        resetsAtMs: untilMs,
      };
    }
    if (gate.kind === "run_fanout" || gate.kind === "invalid_agent_model" || gate.kind === "load_shedding" ||
        gate.kind === "peak_hours" || gate.kind === "ip_capped" || gate.kind === "bounded_429" ||
        gate.kind === "waiting_room_queued" || gate.kind === "waiting_room_required" || gate.kind === "session_limit") {
      const cooldownMs = gate.kind === "load_shedding" ? FREEBUFF_COOLDOWNS.LOAD_SHED_MS
        : gate.kind === "peak_hours" ? FREEBUFF_COOLDOWNS.PEAK_HOURS_MS
        : gate.kind === "run_fanout" ? FREEBUFF_COOLDOWNS.RUN_FANOUT_MS
        : gate.kind === "invalid_agent_model" ? FREEBUFF_COOLDOWNS.INVALID_AGENT_MODEL_MS
        : gate.kind === "ip_capped" ? gate.retryAfterMs
        : gate.kind === "bounded_429" ? FREEBUFF_COOLDOWNS.OPAQUE_429_MS
        : gate.kind === "waiting_room_required" ? (gate.retryAfterMs || FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS)
        : FREEBUFF_COOLDOWNS.WAITING_ROOM_RETRY_MS;
      return {
        status,
        message: `freebuff: ${gate.code}${gate.message ? ` — ${String(gate.message).slice(0, 120)}` : ""}`,
        resetsAtMs: Date.now() + clampFreebuffCooldownMs(cooldownMs),
      };
    }
    if (status === 401) {
      return {
        status,
        message: "freebuff: auth token expired — re-login required in the dashboard (no token refresh exists)",
      };
    }
    if (status === 409 && gate.code === "model_locked") {
      return {
        status,
        message: "freebuff: model_locked — this account's session is locked to another model",
      };
    }
    if (gate.message) return { status, message: `freebuff: ${gate.message.slice(0, 200)}` };
    return super.parseError(response, bodyText);
  }
}

export default FreebuffExecutor;
