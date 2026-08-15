/**
 * FreebuffExecutor — wire ceremony tests.
 * Covers: marker forge (byte-prefix, idempotence, string+array content),
 * end_turn injection, reasoning strip, top-level metadata shape, UA pin,
 * gate sequences (reclaim-once, model_locked no-reclaim, 401 no-refresh,
 * 429 quota with clamped resetAt), and the base-mechanics divergence guard.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  claimSession: vi.fn(),
  clearSession: vi.fn(async () => {}),
  classifyGate: vi.fn(),
  clampFreebuffResetMs: vi.fn((ms) => ms),
  getPersistedSession: vi.fn(() => null),
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
} from "../../open-sse/executors/freebuff.js";
import { FREEBUFF_SYSTEM_MARKER, FREEBUFF_USER_AGENT } from "../../open-sse/config/freebuff.js";

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
  proxyAwareFetch.mockReset();
  sessionMocks.ensureSession.mockResolvedValue(session);
  sessionMocks.claimSession.mockReset();
  sessionMocks.clearSession.mockClear();
  sessionMocks.clampFreebuffResetMs.mockImplementation((ms) => ms);
  sessionMocks.classifyGate.mockImplementation((status) => ({ kind: status === 409 ? "reclaimable" : "other", code: "session_superseded", message: "" }));
  // Zero-delay network retry so the divergence guard doesn't wait real seconds.
  executor.config.retry = { 502: { attempts: 3, delayMs: 0 } };
});

describe("injectFreebuffMarker", () => {
  it("prepends the marker when no system message exists", () => {
    const out = injectFreebuffMarker({ messages: [{ role: "user", content: "hi" }] });
    expect(out.messages[0]).toEqual({ role: "system", content: FREEBUFF_SYSTEM_MARKER });
    expect(out.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("is idempotent when the first system message already opens with the marker", () => {
    const body = { messages: [{ role: "system", content: `${FREEBUFF_SYSTEM_MARKER} Extra` }, { role: "user", content: "hi" }] };
    const out = injectFreebuffMarker(body);
    expect(out).toBe(body); // untouched — same reference
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

  it("sends top-level codebuff_metadata with cost_mode free and the session ids", async () => {
    const { chatCall } = await runAndCapture();
    const sent = JSON.parse(chatCall[1].body);
    expect(sent.codebuff_metadata).toMatchObject({
      run_id: "run-1",
      client_id: "fp-1",
      freebuff_instance_id: "inst-1",
      cost_mode: "free",
    });
    expect(sent.provider).toEqual({ allow_fallbacks: false });
    // metadata is TOP-LEVEL, not nested
    expect(Object.keys(sent)).toContain("codebuff_metadata");
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

  it("pins the exact User-Agent on the chat call", async () => {
    const { chatCall } = await runAndCapture();
    expect(chatCall[1].headers["User-Agent"]).toBe(FREEBUFF_USER_AGENT);
  });

  it("carries the marker as the first system message opener", async () => {
    const { chatCall } = await runAndCapture();
    const sent = JSON.parse(chatCall[1].body);
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[0].content.startsWith(FREEBUFF_SYSTEM_MARKER)).toBe(true);
  });
});

describe("gate handling", () => {
  it("reclaims ONCE on a stale-session gate then succeeds", async () => {
    sessionMocks.claimSession.mockResolvedValue({ ...session, instanceId: "inst-2" });
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))   // START
      .mockResolvedValueOnce(jsonResponse({ error: { code: "session_superseded" } }, 409)) // chat stale
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

  it("surfaces 429 with a clamped resetAt for the Pacific-midnight lock", async () => {
    const resetEpoch = Date.now() + 3 * 3600 * 1000;
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
    expect(sessionMocks.clampFreebuffResetMs).toHaveBeenCalled();
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
