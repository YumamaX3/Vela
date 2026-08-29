/**
 * freebuffSession — claim lifecycle, gate classification, Pacific-midnight clock.
 * Covers: classifyGate matrix (status+code ONLY — a 429 whose message text
 * mentions a gate code must NOT be classified stale), classifyClaimResponse,
 * claim mutex (N concurrent claims -> 1 POST), pacificMidnightMs pinned DST
 * vectors + boundary, clampFreebuffResetMs against hostile resetAt values,
 * and spread-merge write preservation of sibling providerSpecificData keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  updateProviderConnection: vi.fn(async () => {}),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  classifyGate,
  classifyClaimResponse,
  claimSession,
  findWarmConnection,
  writeSession,
  pacificMidnightMs,
  clampFreebuffResetMs,
  stampWaitingRoomRequired,
  __test__,
} from "../../open-sse/services/freebuffSession.js";
import {
  FREEBUFF_BUN_USER_AGENT,
  FREEBUFF_CLI_ADS_UA,
  FREEBUFF_SESSION_TTL_MS,
  FREEBUFF_GLM_SESSION_TTL_MS,
} from "../../open-sse/config/freebuff.js";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  proxyAwareFetch.mockReset();
  __test__.reset();
  dbMocks.getProviderConnections.mockResolvedValue([]);
});

describe("classifyGate — the ascended taxonomy", () => {
  it("classifies session_superseded as TERMINAL superseded in any status", () => {
    // Reference ratelimit.go:199 — containsAny(lower, "session_superseded") is
    // body-marker driven and status-agnostic. Superseded is NEVER reclaimable:
    // another instance took the account; the next request re-joins fresh.
    for (const status of [409, 410, 428, 429]) {
      const g = classifyGate(status, JSON.stringify({ error: { code: "session_superseded" } }));
      expect(g.kind).toBe("superseded");
      expect(g.code).toBe("session_superseded");
    }
  });

  it("keeps session_expired reclaimable across the stale statuses", () => {
    for (const status of [409, 410, 428]) {
      expect(classifyGate(status, JSON.stringify({ error: { code: "session_expired" } })).kind).toBe("reclaimable");
    }
  });

  it("matches superseded on body text regardless of where the marker rides", () => {
    // Reference-faithful: Go's containsAny scans the WHOLE lowercased body —
    // the marker can ride in the message field too. This is deliberate for a
    // terminal gate: misclassifying it as quota would midnight-lock a healthy
    // account.
    const g = classifyGate(429, JSON.stringify({ error: { message: "weird session_superseded mention" } }));
    expect(g.kind).toBe("superseded");
  });

  it("never matches RECLAIMABLE codes on message text alone", () => {
    // The reclaim guard survives the ascension: only STRUCTURED codes open the
    // reclaim loop. A message merely mentioning session_expired must not.
    const g = classifyGate(409, JSON.stringify({ error: { message: "session_expired" } }));
    expect(g.kind).not.toBe("reclaimable");
    expect(g.kind).toBe("stale_unknown");
  });

  it("maps 401 to auth and extracts numeric resetAt as daily_quota on 429", () => {
    expect(classifyGate(401, "{}").kind).toBe("auth");
    const g = classifyGate(429, JSON.stringify({ error: { resetAt: "2026-08-16T07:00:00.000Z" } }));
    expect(g.kind).toBe("daily_quota");
    expect(g.resetAt).toBe(Date.parse("2026-08-16T07:00:00.000Z"));
  });

  it("classifies a daily/weekly period at/over limit as daily_quota without a timestamp", () => {
    const g = classifyGate(429, JSON.stringify({ error: { period: "pacific_day", limit: 40, recentCount: 40 } }));
    expect(g.kind).toBe("daily_quota");
    expect(g.resetAt).toBeUndefined();
    // Under the limit → not a daily cap.
    const under = classifyGate(429, JSON.stringify({ error: { period: "pacific_day", limit: 40, recentCount: 12 } }));
    expect(under.kind).toBe("bounded_429");
  });

  it("survives non-JSON bodies — opaque 429 gets the bounded backoff", () => {
    expect(classifyGate(500, "gateway exploded").kind).toBe("other");
    const g = classifyGate(429, "");
    expect(g.kind).toBe("bounded_429");
    expect(g.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("classifyClaimResponse", () => {
  it("accepts active with instanceId", () => {
    const c = classifyClaimResponse(JSON.stringify({ status: "active", instanceId: "inst-9" }));
    expect(c.kind).toBe("active");
    expect(c.instanceId).toBe("inst-9");
  });
  it("surfaces model_locked and blocked statuses", () => {
    expect(classifyClaimResponse(JSON.stringify({ status: "model_locked" })).kind).toBe("model_locked");
    expect(classifyClaimResponse(JSON.stringify({ status: "country_blocked" })).kind).toBe("blocked");
    expect(classifyClaimResponse(JSON.stringify({ status: "ip_capped" })).kind).toBe("blocked");
  });
});

describe("claimSession", () => {
  const credentials = {
    accessToken: "tok", connectionId: "conn-1",
    providerSpecificData: {}, _connection: { id: "conn-1", providerSpecificData: {} },
  };

  // Isolation: writeSession mutates credentials.providerSpecificData; reset it
  // so one test's claimed session never satisfies another test's warm-check.
  beforeEach(() => {
    credentials.providerSpecificData = {};
    credentials._connection.providerSpecificData = {};
  });

  it("POSTs with x-freebuff-model and persists the claim", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ status: "active", instanceId: "inst-1" }));
    const session = await claimSession(credentials, "mimo/mimo-v2.5");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toContain("/api/v1/freebuff/session");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-freebuff-model"]).toBe("mimo/mimo-v2.5");
    expect(session.instanceId).toBe("inst-1");
    expect(session.agentId).toBe("base2-free-mimo");
    // persisted via spread-merge
    const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(patch.providerSpecificData.freebuff.session.instanceId).toBe("inst-1");
  });

  it("serializes concurrent claims — N callers, exactly 1 POST", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({ status: "active", instanceId: "inst-1" }));
    const results = await Promise.all([
      claimSession(credentials, "mimo/mimo-v2.5"),
      claimSession(credentials, "mimo/mimo-v2.5"),
      claimSession(credentials, "mimo/mimo-v2.5"),
    ]);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    for (const s of results) expect(s.instanceId).toBe("inst-1");
  });

  it("preserves sibling providerSpecificData keys on write (spread-merge)", async () => {
    const credsWithProxy = {
      accessToken: "tok", connectionId: "conn-2",
      providerSpecificData: { connectionProxyUrl: "socks://proxy:1080", freebuff: { fingerprintId: "fp" } },
      _connection: { id: "conn-2", providerSpecificData: { connectionProxyUrl: "socks://proxy:1080", freebuff: { fingerprintId: "fp" } } },
    };
    await writeSession(credsWithProxy, { model: "m", instanceId: "i", expiresAt: new Date(Date.now() + 60000).toISOString() });
    const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(patch.providerSpecificData.connectionProxyUrl).toBe("socks://proxy:1080");
    expect(patch.providerSpecificData.freebuff.fingerprintId).toBe("fp");
    expect(patch.providerSpecificData.freebuff.session.model).toBe("m");
  });

  it("throws a gate-tagged error when the claim is refused", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ status: "country_blocked", message: "nope" }, 403));
    await expect(claimSession(credentials, "mimo/mimo-v2.5")).rejects.toMatchObject({
      freebuffGate: expect.objectContaining({ kind: "blocked", code: "country_blocked" }),
    });
  });

  it("passes strictProxy when a connection proxy is configured", async () => {
    const withProxy = { ...credentials, providerSpecificData: { connectionProxyUrl: "socks://p:1" } };
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ status: "active", instanceId: "i" }));
    await claimSession(withProxy, "mimo/mimo-v2.5");
    const proxyOpts = proxyAwareFetch.mock.calls[0][2];
    expect(proxyOpts.strictProxy).toBe(true);
  });

  it("sends a BODYLESS POST with no Content-Type (reference #120)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ status: "active", instanceId: "i" }));
    await claimSession(credentials, "mimo/mimo-v2.5");
    const [, opts] = proxyAwareFetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeUndefined();
    expect(opts.headers["Content-Type"]).toBeUndefined();
    expect(opts.headers["content-type"]).toBeUndefined();
    // G5 UA scoping: the claim carries the Bun UA, never the ai-sdk chat UA.
    expect(opts.headers["User-Agent"]).toBe(FREEBUFF_BUN_USER_AGENT);
  });

  it("fires the waiting-room ad chain BEFORE the claim when the flag is stamped", async () => {
    await stampWaitingRoomRequired(credentials);
    expect(credentials.providerSpecificData.freebuff.waitingRoomRequiredAt).toBeTruthy();
    proxyAwareFetch.mockResolvedValue(jsonResponse({ status: "active", instanceId: "i" }));
    await claimSession(credentials, "mimo/mimo-v2.5");
    // 2 ads POSTs (gravity + zeroclick) + 1 streak GET + the claim POST.
    expect(proxyAwareFetch).toHaveBeenCalledTimes(4);
    const calls = proxyAwareFetch.mock.calls;
    expect(calls[0][0]).toContain("/api/v1/ads");
    expect(calls[0][1].method).toBe("POST");
    expect(calls[0][1].headers["User-Agent"]).toBe(FREEBUFF_CLI_ADS_UA);
    expect(JSON.parse(calls[0][1].body).provider).toBe("gravity");
    expect(calls[1][0]).toContain("/api/v1/ads");
    expect(JSON.parse(calls[1][1].body).provider).toBe("zeroclick");
    expect(calls[2][0]).toContain("/freebuff/streak");
    expect(calls[2][1].method).toBe("GET");
    expect(calls[3][0]).toContain("/api/v1/freebuff/session");
    // The flag is consumed in-memory and persisted away.
    expect(credentials.providerSpecificData.freebuff.waitingRoomRequiredAt).toBeUndefined();
  });

  it("swallows waiting-room chain failures — the claim still proceeds", async () => {
    credentials.providerSpecificData.freebuff = { waitingRoomRequiredAt: new Date().toISOString() };
    proxyAwareFetch
      .mockRejectedValueOnce(new Error("ads down"))
      .mockRejectedValueOnce(new Error("ads down"))
      .mockRejectedValueOnce(new Error("streak down"))
      .mockResolvedValueOnce(jsonResponse({ status: "active", instanceId: "i" }));
    const session = await claimSession(credentials, "mimo/mimo-v2.5");
    expect(session.instanceId).toBe("i");
  });

  it("applies per-model session TTL — GLM 55min margin, others 23h", async () => {
    const before = Date.now();
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ status: "active", instanceId: "i" }));
    const glmSession = await claimSession(credentials, "z-ai/glm-5.2");
    const glmTtl = new Date(glmSession.expiresAt).getTime() - before;
    expect(glmTtl).toBeGreaterThanOrEqual(FREEBUFF_GLM_SESSION_TTL_MS - 5000);
    expect(glmTtl).toBeLessThanOrEqual(FREEBUFF_GLM_SESSION_TTL_MS + 5000);

    credentials.providerSpecificData = {}; // no warm session for the next claim
    credentials._connection.providerSpecificData = {};
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ status: "active", instanceId: "i2" }));
    const lunaSession = await claimSession(credentials, "openai/gpt-5.6-luna");
    const lunaTtl = new Date(lunaSession.expiresAt).getTime() - before;
    expect(lunaTtl).toBeGreaterThanOrEqual(FREEBUFF_SESSION_TTL_MS - 5000);
    expect(lunaTtl).toBeLessThanOrEqual(FREEBUFF_SESSION_TTL_MS + 5000);
  });
});

describe("findWarmConnection", () => {
  it("finds a persisted warm session by model", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "c1", providerSpecificData: { freebuff: { session: { model: "mimo/mimo-v2.5", instanceId: "i", expiresAt: future } } } },
      { id: "c2", providerSpecificData: {} },
    ]);
    expect(await findWarmConnection("mimo/mimo-v2.5")).toBe("c1");
    expect(await findWarmConnection("openai/gpt-5.6-luna")).toBeNull();
  });

  it("never throws on DB failure (fail-open)", async () => {
    dbMocks.getProviderConnections.mockRejectedValue(new Error("db down"));
    expect(await findWarmConnection("mimo/mimo-v2.5")).toBeNull();
  });
});

describe("pacificMidnightMs — pinned vectors", () => {
  // PDT (UTC-7): Pacific midnight = 07:00 UTC next day.
  it("2026-07-15 12:00 UTC (a normal PDT day) → next day 07:00 UTC", () => {
    const from = Date.parse("2026-07-15T12:00:00.000Z");
    expect(pacificMidnightMs(from)).toBe(Date.parse("2026-07-16T07:00:00.000Z"));
  });

  // PST (UTC-8): Pacific midnight = 08:00 UTC next day.
  it("2026-01-10 12:00 UTC (a normal PST day) → next day 08:00 UTC", () => {
    const from = Date.parse("2026-01-10T12:00:00.000Z");
    expect(pacificMidnightMs(from)).toBe(Date.parse("2026-01-11T08:00:00.000Z"));
  });

  // DST spring-forward 2026-03-08 (LA): midnight stays 07:00 UTC on the 9th.
  it("just before the spring-forward transition → 2026-03-09T07:00Z", () => {
    const from = Date.parse("2026-03-08T23:00:00.000Z"); // 15:00 PDT on the 8th
    expect(pacificMidnightMs(from)).toBe(Date.parse("2026-03-09T07:00:00.000Z"));
  });

  // DST fall-back 2026-11-01 (LA): midnight of the 2nd is 08:00 UTC.
  it("just before the fall-back transition → 2026-11-02T08:00Z", () => {
    const from = Date.parse("2026-11-01T23:00:00.000Z"); // 16:00 PDT on the 1st
    expect(pacificMidnightMs(from)).toBe(Date.parse("2026-11-02T08:00:00.000Z"));
  });

  // Boundary: 1s before Pacific midnight (23:59:59 PDT on the 15th = 06:59:59Z
  // on the 16th) rolls to that imminent midnight — 07:00Z on the 16th.
  it("one second before Pacific midnight → the following midnight", () => {
    const from = Date.parse("2026-07-16T06:59:59.000Z");
    expect(pacificMidnightMs(from)).toBe(Date.parse("2026-07-16T07:00:00.000Z"));
  });
});

describe("clampFreebuffResetMs — hostile inputs", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");
  const midnight = Date.parse("2026-07-16T07:00:00.000Z");

  it("falls back to next Pacific midnight for NaN / undefined / past", () => {
    expect(clampFreebuffResetMs(NaN, now)).toBe(midnight);
    expect(clampFreebuffResetMs(undefined, now)).toBe(midnight);
    expect(clampFreebuffResetMs(now - 1000, now)).toBe(midnight);
  });

  it("clamps a year-2100 resetAt to the quota window", () => {
    const evil = Date.parse("2100-01-01T00:00:00.000Z");
    expect(clampFreebuffResetMs(evil, now)).toBe(midnight);
  });

  it("passes through a valid in-window resetAt untouched", () => {
    const valid = now + 3600_000;
    expect(clampFreebuffResetMs(valid, now)).toBe(valid);
  });
});
