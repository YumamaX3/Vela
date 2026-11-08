// WorkBuddy M2 (plan §III-B, B1 + B2 + B3) — the pins for the live defects.
//
// Three lanes, each a defect that was measured on this shore:
//
//  B1  Refresh dispatcher — WorkBuddy connections carried a refresh token but
//      had NO handler, so getAccessToken warned "Unsupported provider" and the
//      first expiry was a silent 401. Pinned three ways:
//        * REFRESHERS covers all four family ids (a missing id is a provider
//          whose credentials can never rotate — the coverage test sees the
//          whole table, not just the paths this file happens to probe);
//        * each WorkBuddy refresh hits ITS OWN host (cn → workbuddy.cn,
//          intl → workbuddy.ai) — never CodeBuddy's door;
//        * X-Auth-Refresh-Source is "workbuddy" (decision a: the reference
//          proxy yuan240324's working value; CodeBuddy lanes keep "plugin"),
//          and the token rides X-Refresh-Token, and rotation is honoured.
//
//  B2  Usage routing — usage.js routes only the codebuddy-* ids; a working
//      WorkBuddy connection rendered "Usage API not implemented". Pinned by
//      driving getUsageForProvider through a mocked proxyAwareFetch and
//      asserting the billing URL — decision b: the base is the registry's own
//      usage.url (www.workbuddy.cn / www.workbuddy.ai), never hardcoded.
//
//  B3  Identity law — the registries' literal UA strings are gone; the header
//      block is transportHeaders(profile), the one law for all four products.
//
// Harness shape (Vela house): stub global.fetch → THEN dynamic-import, so the
// mocked transport is what the module graph resolves. The usage lane instead
// mocks proxyAwareFetch at the layer it lives on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

// ─── B1: refresh dispatcher ────────────────────────────────────────────────

describe("B1 — REFRESHERS covers all four CodeBuddy-family ids", () => {
  it("has an entry for every family id", async () => {
    const { REFRESHERS } = await import("../../open-sse/services/tokenRefresh.js");
    for (const id of ["codebuddy-cn", "codebuddy-intl", "workbuddy-cn", "workbuddy-intl"]) {
      expect(typeof REFRESHERS[id], `${id} must have a refresh handler`).toBe("function");
    }
  });

  it("is frozen — the table cannot be mutated at runtime", async () => {
    const { REFRESHERS } = await import("../../open-sse/services/tokenRefresh.js");
    expect(Object.isFrozen(REFRESHERS)).toBe(true);
  });

  it("re-exports both WorkBuddy refresh functions from tokenRefresh.js", async () => {
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    expect(typeof mod.refreshWorkbuddyCnToken).toBe("function");
    expect(typeof mod.refreshWorkbuddyIntlToken).toBe("function");
  });
});

describe("B1 — WorkBuddy refresh hits its own host with the workbuddy source", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockTokenResponse(payload) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
  }

  // A unique token per case keeps the refresh dedup cache (provider:oldToken,
  // 10s TTL) from short-circuiting a later case with an earlier result.
  const cases = [
    {
      name: "workbuddy-cn",
      fn: "refreshWorkbuddyCnToken",
      url: "https://www.workbuddy.cn/v2/plugin/auth/token/refresh",
      host: "www.workbuddy.cn",
      ua: "WorkBuddy/5.9.2 WorkBuddy/5.9.2 CLI/2.165.0",
      token: "rt-wb-cn-001",
    },
    {
      name: "workbuddy-intl",
      fn: "refreshWorkbuddyIntlToken",
      url: "https://www.workbuddy.ai/v2/plugin/auth/token/refresh",
      host: "www.workbuddy.ai",
      ua: "WorkBuddy/5.8.4 WorkBuddy AI/5.8.4 CLI/2.161.0",
      token: "rt-wb-intl-001",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: POSTs its own refreshUrl with X-Auth-Refresh-Source=workbuddy`, async () => {
      const fetchMock = mockTokenResponse({
        code: 0,
        data: { accessToken: `at-${c.name}`, refreshToken: `rt-next-${c.name}`, expiresIn: 7200 },
      });
      global.fetch = fetchMock;

      const mod = await import("../../open-sse/services/tokenRefresh.js");
      const result = await mod[c.fn](c.token, null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];

      // Host correctness — the WorkBuddy door, never CodeBuddy's.
      expect(url).toBe(c.url);
      expect(new URL(url).host).toBe(c.host);

      expect(init.method).toBe("POST");
      const h = init.headers;
      // Decision (a): the WorkBuddy value, NOT CodeBuddy's "plugin".
      expect(h["X-Auth-Refresh-Source"]).toBe("workbuddy");
      expect(h["X-Auth-Refresh-Source"]).not.toBe("plugin");
      expect(h["X-Refresh-Token"]).toBe(c.token);
      expect(h["X-Domain"]).toBe(c.host);
      expect(h["X-Product"]).toBe("SaaS");
      // User-Agent rides the registry's oauth block, per shore.
      expect(h["User-Agent"]).toBe(c.ua);
      expect(init.body).toBe("{}");

      // Rotation honoured: the new pair comes back through the house shape.
      expect(result).toEqual({
        accessToken: `at-${c.name}`,
        refreshToken: `rt-next-${c.name}`,
        expiresIn: 7200,
      });
    });
  }

  it("keeps the old refresh token when the server does not rotate it", async () => {
    global.fetch = mockTokenResponse({
      code: 0,
      data: { accessToken: "at-keep", expiresIn: 3600 },
    });

    const { refreshWorkbuddyCnToken } = await import("../../open-sse/services/tokenRefresh.js");
    const result = await refreshWorkbuddyCnToken("rt-unrotated-777", null);

    expect(result.accessToken).toBe("at-keep");
    expect(result.refreshToken).toBe("rt-unrotated-777");
  });

  it("returns null on a non-2xx answer", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorized"),
    });

    const { refreshWorkbuddyIntlToken } = await import("../../open-sse/services/tokenRefresh.js");
    expect(await refreshWorkbuddyIntlToken("rt-rejected-888", null)).toBeNull();
  });

  it("returns null when the envelope carries no token (code !== 0)", async () => {
    global.fetch = mockTokenResponse({ code: 11129, msg: "no token" });

    const { refreshWorkbuddyCnToken } = await import("../../open-sse/services/tokenRefresh.js");
    expect(await refreshWorkbuddyCnToken("rt-empty-999", null)).toBeNull();
  });

  it("returns null without a network call when the registry has no baseUrl (X-Domain underivable)", async () => {
    const { PROVIDER_OAUTH } = await import("../../open-sse/providers/index.js");
    const { refreshWorkbuddyCnToken } = await import("../../open-sse/services/tokenRefresh.js");

    const saved = PROVIDER_OAUTH["workbuddy-cn"].baseUrl;
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    try {
      delete PROVIDER_OAUTH["workbuddy-cn"].baseUrl;
      // A clean null — never a thrown URL parse surfacing as a refresh crash.
      expect(await refreshWorkbuddyCnToken("rt-no-base-4242", null)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      PROVIDER_OAUTH["workbuddy-cn"].baseUrl = saved;
    }
  });

  it("short-circuits on an empty refresh token without touching the network", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const { refreshWorkbuddyCnToken, refreshWorkbuddyIntlToken } = await import(
      "../../open-sse/services/tokenRefresh.js"
    );
    expect(await refreshWorkbuddyCnToken("", null)).toBeNull();
    expect(await refreshWorkbuddyIntlToken(undefined, null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── B2: usage routing ─────────────────────────────────────────────────────

describe("B2 — usage.js routes both WorkBuddy ids to their own billing door", () => {
  const billingPayload = {
    code: 0,
    data: {
      Response: {
        Data: {
          Accounts: [
            {
              PackageName: "WorkBuddy Pro",
              CycleStartTime: Date.now() - 5 * 86400000,
              CycleEndTime: Date.now() + 25 * 86400000,
              DeductionEndTime: Date.now() + 35 * 86400000,
              CycleCapacityUsedPrecise: "1.5",
              CycleCapacitySizePrecise: "500",
            },
          ],
        },
      },
    },
  };

  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(billingPayload),
    });
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: fetchMock,
      default: fetchMock,
    }));
  });

  afterEach(() => {
    vi.doUnmock("../../open-sse/utils/proxyFetch.js");
    vi.resetModules();
  });

  const routes = [
    { id: "workbuddy-cn", host: "www.workbuddy.cn" },
    { id: "workbuddy-intl", host: "www.workbuddy.ai" },
  ];

  for (const r of routes) {
    it(`${r.id}: is routed (not "not implemented") and bills at ${r.host}`, async () => {
      const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
      const usage = await getUsageForProvider({
        provider: r.id,
        accessToken: `at-${r.id}`,
        providerSpecificData: {},
      });

      // The regression: this used to be "Usage API not implemented for <id>".
      expect(usage?.message ?? "").not.toMatch(/not implemented/i);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://${r.host}/v2/billing/meter/get-user-resource`);
      expect(new URL(url).host).toBe(r.host);
      expect(url).not.toContain("codebuddy"); // never the sibling's door
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe(`Bearer at-${r.id}`);

      // The billing envelope parses through the shared CodeBuddy reader.
      expect(usage.plan).toBe("WorkBuddy Pro");
      expect(usage.quotas.Monthly).toMatchObject({ used: 1.5, total: 500, recurring: true });
    });
  }

  it("mirrors the registry's own usage.url — the base is read, not retyped", async () => {
    const registryCn = (await import("../../open-sse/providers/registry/workbuddy-cn.js")).default;
    const registryIntl = (await import("../../open-sse/providers/registry/workbuddy-intl.js")).default;

    expect(registryCn.transport.usage.url).toBe(
      "https://www.workbuddy.cn/v2/billing/meter/get-user-resource",
    );
    expect(registryIntl.transport.usage.url).toBe(
      "https://www.workbuddy.ai/v2/billing/meter/get-user-resource",
    );

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    await getUsageForProvider({ provider: "workbuddy-cn", accessToken: "at-x" });
    expect(fetchMock.mock.calls[0][0]).toBe(registryCn.transport.usage.url);
  });
});

// ─── B3: identity law ──────────────────────────────────────────────────────

describe("B3 — WorkBuddy registries speak transportHeaders()", () => {
  it("cn headers are exactly transportHeaders('cn-work') — no literal UA", async () => {
    const { transportHeaders } = await import("../../open-sse/shared/codebuddy/identity.js");
    const registry = (await import("../../open-sse/providers/registry/workbuddy-cn.js")).default;

    expect(registry.transport.headers).toEqual(transportHeaders("cn-work"));
    expect(registry.transport.headers["User-Agent"]).toBe(
      "WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/2.165.0",
    );
    expect(registry.transport.headers["X-IDE-Type"]).toBe("WorkBuddy");
  });

  it("intl headers are exactly transportHeaders('intl-work') — the AI name on this shore", async () => {
    const { transportHeaders } = await import("../../open-sse/shared/codebuddy/identity.js");
    const registry = (await import("../../open-sse/providers/registry/workbuddy-intl.js")).default;

    expect(registry.transport.headers).toEqual(transportHeaders("intl-work"));
    expect(registry.transport.headers["User-Agent"]).toBe(
      "WorkBuddy/5.9.4 WorkBuddy AI/5.9.4 CLI/2.165.0",
    );
  });

  it("both shores keep the SaaS tier and the request markers", async () => {
    const cn = (await import("../../open-sse/providers/registry/workbuddy-cn.js")).default;
    const intl = (await import("../../open-sse/providers/registry/workbuddy-intl.js")).default;
    for (const r of [cn, intl]) {
      expect(r.transport.headers["X-Product"]).toBe("SaaS");
      expect(r.transport.headers["x-requested-with"]).toBe("XMLHttpRequest");
      expect(r.transport.headers["x-codebuddy-request"]).toBe("1");
    }
  });
});
