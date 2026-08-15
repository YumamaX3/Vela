/**
 * freebuff usage handler — GET-only quota invariant + rateLimitsByModel parse.
 * The fetch spy asserts NO POST ever leaves this module: a POST to the session
 * endpoint CLAIMS a session and burns one of ~6 daily quota units.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getFreebuffUsage, parseFreebuffQuotas } from "../../open-sse/services/usage/freebuff.js";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  proxyAwareFetch.mockReset();
});

describe("parseFreebuffQuotas", () => {
  it("maps rateLimitsByModel into quota rows with percentage remaining", () => {
    const quotas = parseFreebuffQuotas({
      rateLimitsByModel: {
        "mimo/mimo-v2.5": { limit: 6, recentCount: 1.3, resetAt: 1786900000000 },
        "deepseek/deepseek-v4-flash": { limit: 6, recentCount: 0, resetAt: "2026-08-16T07:00:00.000Z" },
      },
    });
    expect(quotas["mimo-v2.5"].total).toBe(6);
    expect(quotas["mimo-v2.5"].used).toBeCloseTo(1.3);
    expect(quotas["mimo-v2.5"].remainingPercentage).toBeCloseTo(((6 - 1.3) / 6) * 100);
    expect(quotas["deepseek-v4-flash"].resetAt).toBe("2026-08-16T07:00:00.000Z");
  });

  it("returns empty quotas for missing/malformed payloads", () => {
    expect(parseFreebuffQuotas(null)).toEqual({});
    expect(parseFreebuffQuotas({})).toEqual({});
    expect(parseFreebuffQuotas({ rateLimitsByModel: { bad: "nope" } })).toEqual({});
  });
});

describe("getFreebuffUsage", () => {
  it("NEVER POSTs — the quota path is GET-only", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({ rateLimitsByModel: {} }));
    await getFreebuffUsage("tok", {});
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][1].method).toBe("GET");
    for (const call of proxyAwareFetch.mock.calls) {
      expect(call[1].method).not.toBe("POST");
    }
  });

  it("returns the plan label and per-model quotas", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({
      accessTier: "limited",
      rateLimitsByModel: { "mimo/mimo-v2.5": { limit: 6, recentCount: 2, resetAt: 1786900000000 } },
    }));
    const result = await getFreebuffUsage("tok", {});
    expect(result.plan).toBe("Freebuff (Limited)");
    expect(result.quotas["mimo-v2.5"].used).toBe(2);
  });

  it("maps 401 to a re-login message", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({}, 401));
    const result = await getFreebuffUsage("tok", {});
    expect(result.message).toMatch(/re-login/i);
  });

  it("maps 404 to a no-session message", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({}, 404));
    const result = await getFreebuffUsage("tok", {});
    expect(result.message).toMatch(/no freebuff session/i);
  });

  it("refuses without a token", async () => {
    const result = await getFreebuffUsage(null, {});
    expect(result.message).toMatch(/not available/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("forces strictProxy when a connection proxy is configured", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({ rateLimitsByModel: {} }));
    await getFreebuffUsage("tok", { connectionProxyUrl: "socks://p:1" });
    expect(proxyAwareFetch.mock.calls[0][2].strictProxy).toBe(true);
  });
});
