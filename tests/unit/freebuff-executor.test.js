/**
 * FreebuffExecutor — wire ceremony tests.
 * Covers: marker forge (byte-prefix, idempotence, string+array content,
 * base3 selection, five-gate idempotency), end_turn injection, reasoning
 * strip, top-level metadata shape (client_id 13-char base36, trace_session_id,
 * llm_step_number, stop sentinel, provider block), UA pin, gate sequences
 * (reclaim-once, superseded terminal, model_locked no-reclaim, 401 no-refresh,
 * daily quota with clamped resetAt, bounded 429, paused-model refusal,
 * capacity-deferred in-place retry), and the base-mechanics divergence guard.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  claimSession: vi.fn(),
  clearSession: vi.fn(async () => {}),
  classifyGate: vi.fn(),
  clampFreebuffResetMs: vi.fn((ms) => ms),
  clampFreebuffCooldownMs: vi.fn((ms) => ms || 0),
  getPersistedSession: vi.fn(() => null),
  stampWaitingRoomRequired: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/services/freebuffSession.js", () => sessionMocks);
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));
vi.mock("../../open-sse/utils/debugLog.js", () => ({ dbg: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  FreebuffExecutor,
  injectFreebuffMarker,
  generateCliClientId,
} from "../../open-sse/executors/freebuff.js";
import {
  FREEBUFF_SYSTEM_MARKER,
  FREEBUFF_SYSTEM_MARKER_BASE3,
  FREEBUFF_GATE_OPENINGS,
  FREEBUFF_STOP_SENTINEL,
  FREEBUFF_USER_AGENT,
  FREEBUFF_COOLDOWNS,
} from "../../open-sse/config/freebuff.js";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const credentials = {
  accessToken: "tok-fb",
  connectionId: "conn-fb",
  providerSpecificData: { freebuff: { fingerprintId: "fp-1" } },
  _connection: { id: "conn-fb", providerSpecificData: {} },
};

const session = { model: "mimo/mimo-v2.5", instanceId: "inst-1", agentId: "base2-free-mimo", claimedAt: "2026-08-15T00:00:00Z", expiresAt: "2026-08-15T01:00:00Z" };

const executor = new FreebuffExecutor();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  proxyAwareFetch.mockReset();
  sessionMocks.ensureSession.mockResolvedValue(session);
  sessionMocks.claimSession.mockReset();
  sessionMocks.clearSession.mockClear();
  sessionMocks.clampFreebuffResetMs.mockImplementation((ms) => ms);
  sessionMocks.clampFreebuffCooldownMs.mockImplementation((ms) => ms || 0);
  sessionMocks.stampWaitingRoomRequired.mockClear();
  sessionMocks.classifyGate.mockImplementation((status) => ({ kind: status === 409 ? "reclaimable" : "other", code: "session_expired", message: "" }));
  // Zero-delay network retry so the divergence guard doesn't wait real seconds.
  executor.config.retry = { 502: { attempts: 3, delayMs: 0 } };
});

describe("generateCliClientId", () => {
  it("mints 13-char base36 ids of the SDK shape", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateCliClientId();
      expect(id).toMatch(/^[0-9a-z]{13}$/);
    }
  });

  it("never repeats across draws", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateCliClientId()));
    expect(ids.size).toBe(200);
  });
});

describe("injectFreebuffMarker", () => {
  it("prepends the marker when no system message exists", () => {
    const out = injectFreebuffMarker({ messages: [{ role: "user", content: "hi" }] });
    expect(out.messages[0]).toEqual({ role: "system", content: FREEBUFF_SYSTEM_MARKER });
    expect(out.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("selects the base3 marker for base3 agent roots", () => {
    const out = injectFreebuffMarker({ messages: [{ role: "user", content: "hi" }] }, "base3-legacy-agent");
    expect(out.messages[0].content).toBe(FREEBUFF_SYSTEM_MARKER_BASE3);
  });

  it("is idempotent when the first system message already opens with the marker", () => {
    const body = { messages: [{ role: "system", content: `${FREEBUFF_SYSTEM_MARKER} Extra` }, { role: "user", content: "hi" }] };
    const out = injectFreebuffMarker(body);
    expect(out).toBe(body); // untouched — same reference
  });

  it("honors ANY of the five canonical gate openings (trimmed-prefix)", () => {
    expect(FREEBUFF_GATE_OPENINGS.length).toBe(5);
    for (const opening of FREEBUFF_GATE_OPENINGS) {
      // Leading whitespace must not break the gate test.
      const body = { messages: [{ role: "system", content: `  \n${opening} — custom tail` }, { role: "user", content: "hi" }] };
      expect(injectFreebuffMarker(body, "base2-free-mimo")).toBe(body);
    }
  });

  it("prepends into an existing non-marker system message", () => {
    const out = injectFreebuffMarker({ messages: [{ role: "system", content: "custom prompt" }] });
    expect(out.messages[0].content.startsWith(FREEBUFF_SYSTEM_MARKER)).toBe(true);
    expect(out.messages[0].content).toContain("custom prompt");
  });

  it("handles array-shaped system content (OpenAI-source clients)", () => {
    const out = injectFreebuffMarker({ messages: [{ role: "system", content: [{ type: "text", text: "array prompt" }] }] });
    expect(typeof out.messages[0].content).toBe("string");
    expect(out.messages[0].content.startsWith(FREEBUFF_SYSTEM_MARKER)).toBe(true);
    expect(out.messages[0].content).toContain("array prompt");
  });

  it("adds a system message when messages is empty", () => {
    const out = injectFreebuffMarker({ messages: [] });
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].content).toBe(FREEBUFF_SYSTEM_MARKER);
  });
});

describe("body forge", () => {
  async function runAndCapture() {
    // agent-runs START ok, chat ok
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    const result = await executor.execute({
      model: "mimo/mimo-v2.5",
      body: { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "bash" } }], reasoning_effort: "high", reasoning: { type: "auto" } },
      stream: true,
      credentials,
      signal: null,
      log: null,
      proxyOptions: null,
    });
    const chatCall = proxyAwareFetch.mock.calls[1];
    return { result, chatCall };
  }

  it("sends top-level codebuff_metadata with per-run client_id + trace_session_id", async () => {
    const { chatCall } = await runAndCapture();
    const sent = JSON.parse(chatCall[1].body);
    expect(sent.codebuff_metadata).toMatchObject({
      run_id: "run-1",
      freebuff_instance_id: "inst-1",
      cost_mode: "free",
      llm_step_number: "1",
    });
    // client_id is a freshly minted 13-char base36 per run — NEVER the old
    // fingerprintId passthrough, never a uuid (fanout/ban-grade signal).
    expect(sent.codebuff_metadata.client_id).toMatch(/^[0-9a-z]{13}$/);
    expect(sent.codebuff_metadata.client_id).not.toBe("fp-1");
    // trace_session_id is a per-run UUID — deliberately distinct from the
    // persisted instanceId (reference parity).
    expect(sent.codebuff_metadata.trace_session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(sent.codebuff_metadata.trace_session_id).not.toBe("inst-1");
    expect(sent.provider).toEqual({ data_collection: "deny", allow_fallbacks: false });
    // metadata is TOP-LEVEL, not nested
    expect(Object.keys(sent)).toContain("codebuff_metadata");
  });

  it("keeps client_id + trace_session_id stable across retries of one run", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))   // START
      .mockResolvedValueOnce(jsonResponse({ error: { code: "session_expired" } }, 409)) // chat stale
      .mockResolvedValueOnce(jsonResponse({}, 200))              // FINISH cancelled
      .mockResolvedValueOnce(jsonResponse({ runId: "run-2" }))   // re-START after reclaim
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))    // chat retry
      .mockResolvedValueOnce(jsonResponse({}, 200));             // FINISH completed
    sessionMocks.claimSession.mockResolvedValue({ ...session, instanceId: "inst-2" });
    await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    const chatCalls = proxyAwareFetch.mock.calls.filter(([, opts]) => opts?.body && JSON.parse(opts.body).codebuff_metadata);
    expect(chatCalls.length).toBe(2);
    const first = JSON.parse(chatCalls[0][1].body).codebuff_metadata;
    const second = JSON.parse(chatCalls[1][1].body).codebuff_metadata;
    expect(second.client_id).toBe(first.client_id);
    expect(second.trace_session_id).toBe(first.trace_session_id);
  });

  it("injects the JSON-encoded stop sentinel only when the client sent none", async () => {
    const { chatCall } = await runAndCapture();
    const sent = JSON.parse(chatCall[1].body);
    expect(sent.stop).toEqual([FREEBUFF_STOP_SENTINEL]);
    expect(FREEBUFF_STOP_SENTINEL).toBe('"cb_easp"'); // JSON-encoded token, not raw

    // Client-supplied stop is preserved untouched.
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    await executor.execute({
      model: "mimo/mimo-v2.5",
      body: { messages: [{ role: "user", content: "hi" }], stop: ["STOP"] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    // The last call carrying a forged chat body (FINISH rides the same fetch
    // mock fire-and-forget, so select by shape, not index).
    const chatBodies = proxyAwareFetch.mock.calls
      .map(([, opts]) => opts?.body)
      .filter((b) => b && JSON.parse(b).codebuff_metadata)
      .map((b) => JSON.parse(b));
    expect(chatBodies.at(-1).stop).toEqual(["STOP"]);
    expect(chatBodies[0].stop).toEqual([FREEBUFF_STOP_SENTINEL]);
  });

  it("strips reasoning_effort and reasoning", async () => {
    const { chatCall } = await runAndCapture();
    const sent = JSON.parse(chatCall[1].body);
    expect(sent).not.toHaveProperty("reasoning_effort");
    expect(sent).not.toHaveProperty("reasoning");
  });

  it("appends the end_turn tool only when tools exist", async () => {
    const { chatCall } = await runAndCapture();
    const sent = JSON.parse(chatCall[1].body);
    const names = sent.tools.map((t) => t.function?.name || t.name);
    expect(names).toContain("bash");
    expect(names).toContain("end_turn");
  });

  it("does not add end_turn when the client sent no tools", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    await executor.execute({
      model: "mimo/mimo-v2.5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    const sent = JSON.parse(proxyAwareFetch.mock.calls[1][1].body);
    expect(sent.tools).toBeUndefined();
  });

  it("pins the exact User-Agent on the chat call — and no model/instance headers", async () => {
    const { chatCall } = await runAndCapture();
    expect(chatCall[1].headers["User-Agent"]).toBe(FREEBUFF_USER_AGENT);
    // Reference #106: the chat POST carries NO x-freebuff-* headers; the model
    // and instance id ride ONLY in the body metadata.
    expect(chatCall[1].headers["x-freebuff-model"]).toBeUndefined();
    expect(chatCall[1].headers["x-freebuff-instance-id"]).toBeUndefined();
  });

  it("carries the marker as the first system message opener", async () => {
    const { chatCall } = await runAndCapture();
    const sent = JSON.parse(chatCall[1].body);
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[0].content.startsWith(FREEBUFF_SYSTEM_MARKER)).toBe(true);
  });

  it("agent-runs START carries dual auth + Bun UA", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    const startCall = proxyAwareFetch.mock.calls[0];
    expect(startCall[0]).toContain("/api/v1/agent-runs");
    expect(startCall[1].headers["x-codebuff-api-key"]).toBe("tok-fb");
    expect(startCall[1].headers.Authorization).toBe("Bearer tok-fb");
    expect(startCall[1].headers["User-Agent"]).not.toBe(FREEBUFF_USER_AGENT);
    const body = JSON.parse(startCall[1].body);
    expect(body.action).toBe("START");
  });
});

describe("gate handling", () => {
  it("reclaims ONCE on a stale-session gate then succeeds", async () => {
    sessionMocks.claimSession.mockResolvedValue({ ...session, instanceId: "inst-2" });
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))   // START
      .mockResolvedValueOnce(jsonResponse({ error: { code: "session_expired" } }, 409)) // chat stale
      .mockResolvedValueOnce(jsonResponse({}, 200))              // FINISH old run (fire-and-forget)
      .mockResolvedValueOnce(jsonResponse({ runId: "run-2" }))   // re-START
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))    // chat retry
      .mockResolvedValueOnce(jsonResponse({}, 200));             // FINISH completed
    const result = await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(200);
    expect(sessionMocks.claimSession).toHaveBeenCalledTimes(1);
    expect(sessionMocks.clearSession).toHaveBeenCalledTimes(1);
  });

  it("surfaces session_superseded as TERMINAL — clears session, never reclaims", async () => {
    sessionMocks.classifyGate.mockReturnValue({ kind: "superseded", code: "session_superseded", message: "" });
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "session_superseded" } }, 409))
      .mockResolvedValueOnce(jsonResponse({}, 200)); // FINISH failed
    const result = await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(409);
    const body = await result.response.json();
    expect(body.error.code).toBe("session_superseded");
    // The session is dropped so the NEXT request re-joins fresh…
    expect(sessionMocks.clearSession).toHaveBeenCalledWith(credentials, "session_superseded");
    // …but NO in-request reclaim (ping-pong risk — reference ratelimit.go:205).
    expect(sessionMocks.claimSession).not.toHaveBeenCalled();
  });

  it("does NOT reclaim on model_locked — surfaces 409 without burning a claim", async () => {
    sessionMocks.classifyGate.mockReturnValue({ kind: "model_locked", code: "model_locked", message: "" });
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "model_locked" } }, 409))
      .mockResolvedValueOnce(jsonResponse({}, 200)); // FINISH cancelled
    const result = await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(409);
    expect(sessionMocks.claimSession).not.toHaveBeenCalled();
  });

  it("drops the session and demands re-login on 401", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "unauthorized" } }, 401))
      .mockResolvedValueOnce(jsonResponse({}, 200)); // FINISH cancelled
    const result = await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(401);
    expect(sessionMocks.clearSession).toHaveBeenCalled();
  });

  it("surfaces daily_quota with a clamped resetAt for the Pacific-midnight lock", async () => {
    const resetEpoch = Date.now() + 3 * 3600 * 1000;
    sessionMocks.classifyGate.mockReturnValue({ kind: "daily_quota", code: "quota_exhausted", message: "", resetAt: resetEpoch });
    sessionMocks.clampFreebuffResetMs.mockReturnValue(resetEpoch);
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "rate_limited", resetAt: resetEpoch } }, 429))
      .mockResolvedValueOnce(jsonResponse({}, 200)); // FINISH failed
    const result = await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(429);
    const body = await result.response.json();
    expect(body.error.resetAt).toBe(resetEpoch);
    expect(body.error.code).toBe("quota_exhausted");
    expect(sessionMocks.clampFreebuffResetMs).toHaveBeenCalled();
  });

  it("surfaces bounded 429 kinds with retryAfterMs — never a midnight lock", async () => {
    sessionMocks.classifyGate.mockReturnValue({ kind: "load_shedding", code: "load_shedding", message: "", retryAfterMs: FREEBUFF_COOLDOWNS.LOAD_SHED_MS });
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "insufficient_quota" } }, 429))
      .mockResolvedValueOnce(jsonResponse({}, 200)); // FINISH failed
    const result = await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(429);
    const body = await result.response.json();
    expect(body.error.retryAfterMs).toBe(FREEBUFF_COOLDOWNS.LOAD_SHED_MS);
    // No resetAt — bounded codes rotate accounts, they never midnight-lock.
    expect(body.error.resetAt).toBeUndefined();
  });

  it("stamps the waiting-room flag and surfaces 428 on waiting_room_required", async () => {
    sessionMocks.classifyGate.mockReturnValue({ kind: "waiting_room_required", code: "waiting_room_required", message: "" });
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "waiting_room_required" } }, 428))
      .mockResolvedValueOnce(jsonResponse({}, 200)); // FINISH failed
    const result = await executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(428);
    expect(sessionMocks.stampWaitingRoomRequired).toHaveBeenCalledWith(credentials);
  });

  it("retries capacity_deferred IN PLACE against the same session", async () => {
    vi.useFakeTimers();
    try {
      sessionMocks.classifyGate.mockImplementation((status, text) => {
        if (status >= 400 && String(text).includes("free_mode_capacity_deferred")) {
          return { kind: "capacity_deferred", code: "free_mode_capacity_deferred", message: "", retryAfterMs: 15000 };
        }
        return { kind: "other", code: null, message: "" };
      });
      proxyAwareFetch
        .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))                              // START
        .mockResolvedValueOnce(jsonResponse({ error: { code: "free_mode_capacity_deferred", retryAfterMs: 15000 } }, 429)) // deferred 1
        .mockResolvedValueOnce(jsonResponse({ error: { code: "free_mode_capacity_deferred", retryAfterMs: 15000 } }, 429)) // deferred 2
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))                               // success on 3rd
        .mockResolvedValueOnce(jsonResponse({}, 200));                                        // FINISH
      const promise = executor.execute({
        model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
        stream: true, credentials, signal: null, log: null, proxyOptions: null,
      });
      // Two deferred waits of ≥10s each (fake timers).
      await vi.advanceTimersByTimeAsync(15000);
      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;
      expect(result.response.status).toBe(200);
      // Same session, same run — never reclaimed, never claimed again.
      expect(sessionMocks.claimSession).not.toHaveBeenCalled();
      expect(sessionMocks.clearSession).not.toHaveBeenCalled();
      // Exactly one START call (FINISH rides the same URL with its own action).
      const startCalls = proxyAwareFetch.mock.calls.filter(
        ([url, opts]) => url.includes("/agent-runs") && opts?.body && JSON.parse(opts.body).action === "START",
      );
      expect(startCalls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses paused models with an honest 400 BEFORE burning a session", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({}, 200));
    const result = await executor.execute({
      model: "minimax/minimax-m3", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    });
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.error.code).toBe("model_paused");
    expect(body.error.message).toContain("minimax-m3");
    expect(body.error.message).toContain("gpt-5.6-luna"); // names the replacement
    expect(sessionMocks.ensureSession).not.toHaveBeenCalled();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("refreshCredentials returns null immediately (no refresh path)", async () => {
    expect(await executor.refreshCredentials(credentials, null)).toBeNull();
  });
});

describe("base-mechanics divergence guard", () => {
  it("retries network errors via the 502 retry entry, then surfaces", async () => {
    // 502 attempts in DEFAULT_RETRY_CONFIG is 3 — exhaust them, then throw path.
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { name: "FetchError" }))
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { name: "FetchError" }))
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { name: "FetchError" }))
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { name: "FetchError" }));
    await expect(executor.execute({
      model: "mimo/mimo-v2.5", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials, signal: null, log: null, proxyOptions: null,
    })).rejects.toThrow();
    // START + initial chat + 3 retries = 5 calls (4 chat-path fetches after START)
    expect(proxyAwareFetch.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
