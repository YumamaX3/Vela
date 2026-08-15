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
  __test__,
} from "../../open-sse/services/freebuffSession.js";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  proxyAwareFetch.mockReset();
  __test__.reset();
  dbMocks.getProviderConnections.mockResolvedValue([]);
});

describe("classifyGate — structured code matching only", () => {
  it("classifies 409/410/428 with reclaimable codes", () => {
    for (const status of [409, 410, 428]) {
      const g = classifyGate(status, JSON.stringify({ error: { code: "session_superseded" } }));
      expect(g.kind).toBe("reclaimable");
    }
    expect(classifyGate(409, JSON.stringify({ error: { code: "session_expired" } })).kind).toBe("reclaimable");
  });

  it("classifies model_locked distinctly", () => {
    const g = classifyGate(409, JSON.stringify({ error: { code: "model_locked" } }));
    expect(g.kind).toBe("model_locked");
  });

  it("does NOT classify a 429 whose message text mentions session_superseded as stale", () => {
    const g = classifyGate(429, JSON.stringify({ error: { message: "weird session_superseded mention" } }));
    expect(g.kind).toBe("quota");
    expect(g.kind).not.toBe("reclaimable");
  });

  it("never matches on message text alone for stale gates", () => {
    const g = classifyGate(409, JSON.stringify({ error: { message: "session_superseded" } }));
    // message-only match must NOT produce reclaimable (code field absent)
    expect(g.kind).not.toBe("reclaimable");
    expect(g.kind).toBe("stale_unknown");
  });

  it("maps 401 to auth and extracts numeric resetAt on 429", () => {
    expect(classifyGate(401, "{}").kind).toBe("auth");
    const g = classifyGate(429, JSON.stringify({ error: { resetAt: "2026-08-16T07:00:00.000Z" } }));
    expect(g.kind).toBe("quota");
    expect(g.resetAt).toBe(Date.parse("2026-08-16T07:00:00.000Z"));
  });

  it("survives non-JSON bodies", () => {
    expect(classifyGate(500, "gateway exploded").kind).toBe("other");
    expect(classifyGate(429, "").kind).toBe("quota");
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
