// M5 — zcode-plan OAuth (device_code / CLI poll). The provider reads the global
// fetch, so every case stubs it with vi.stubGlobal; the constants barrel is mocked
// at the exact specifier the provider imports so the flow runs against test doubles.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/oauth/constants/oauth.js", () => ({
  GLM_OAUTH_CONFIG: {
    cliInitUrl: "https://zcode.test/api/v1/oauth/cli/init",
    cliPollUrl: "https://zcode.test/api/v1/oauth/cli/poll",
    providerId: "zai",
  },
}));

import zcodePlan from "../../src/lib/oauth/providers/zcode-plan.js";

const CONFIG = {
  cliInitUrl: "https://zcode.test/api/v1/oauth/cli/init",
  cliPollUrl: "https://zcode.test/api/v1/oauth/cli/poll",
  providerId: "zai",
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function installFetch(handler) {
  const fn = vi.fn(handler);
  vi.stubGlobal("fetch", fn);
  return fn;
}

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  vi.unstubAllGlobals();
  // vi.stubGlobal("fetch") removes the global on restore; put the real one back.
  if (globalThis.fetch !== realFetch) globalThis.fetch = realFetch;
});

describe("zcode-plan OAuth — module shape", () => {
  it("declares the device_code flow", () => {
    expect(zcodePlan.flowType).toBe("device_code");
    expect(typeof zcodePlan.requestDeviceCode).toBe("function");
    expect(typeof zcodePlan.pollToken).toBe("function");
    expect(typeof zcodePlan.mapTokens).toBe("function");
  });

  it("config is the mocked GLM_OAUTH_CONFIG", () => {
    expect(zcodePlan.config.cliInitUrl).toBe(CONFIG.cliInitUrl);
    expect(zcodePlan.config.providerId).toBe("zai");
  });
});

describe("requestDeviceCode", () => {
  it("happy path — POSTs init with a Bearer 32-byte hex poll token and provider zai", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const fetchMock = installFetch(async () =>
      jsonResponse({
        code: 0,
        data: {
          authorize_url: "https://z.ai/authorize?x=1",
          flow_id: "flow-123",
          poll_interval_sec: 2,
          expires_at: expiresAt,
        },
      }),
    );

    const out = await zcodePlan.requestDeviceCode(CONFIG);
    expect(out.device_code).toBe("flow-123");
    expect(out.verification_uri).toBe("https://z.ai/authorize?x=1");
    expect(out.interval).toBe(2);
    expect(out.expires_in).toBeGreaterThan(590);
    expect(out.expires_in).toBeLessThanOrEqual(600);
    expect(out._zcodePollToken).toMatch(/^[0-9a-f]{64}$/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CONFIG.cliInitUrl);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${out._zcodePollToken}`);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ provider: "zai" });
  });

  it("defaults expire to 300s and interval to 3s when the payload omits them", async () => {
    installFetch(async () =>
      jsonResponse({ code: 0, data: { authorize_url: "https://z.ai/a", flow_id: "f" } }),
    );
    const out = await zcodePlan.requestDeviceCode(CONFIG);
    expect(out.expires_in).toBe(300);
    expect(out.interval).toBe(3);
  });

  it("a past expires_at also falls back to 300s", async () => {
    installFetch(async () =>
      jsonResponse({
        code: 0,
        data: { authorize_url: "https://z.ai/a", flow_id: "f", expires_at: Math.floor(Date.now() / 1000) - 10 },
      }),
    );
    expect((await zcodePlan.requestDeviceCode(CONFIG)).expires_in).toBe(300);
  });

  it("accepts a millisecond expires_at", async () => {
    const ms = Date.now() + 900_000;
    installFetch(async () =>
      jsonResponse({ code: 0, data: { authorize_url: "https://z.ai/a", flow_id: "f", expires_at: ms } }),
    );
    const out = await zcodePlan.requestDeviceCode(CONFIG);
    expect(out.expires_in).toBeGreaterThan(890);
    expect(out.expires_in).toBeLessThanOrEqual(900);
  });

  it("throws when the init is not ok", async () => {
    installFetch(async () => jsonResponse("upstream exploded", { ok: false, status: 500 }));
    await expect(zcodePlan.requestDeviceCode(CONFIG)).rejects.toThrow(/init failed: upstream exploded/);
  });

  it("throws with the upstream msg when the code is not success", async () => {
    installFetch(async () => jsonResponse({ code: 1005, msg: "no seat" }));
    await expect(zcodePlan.requestDeviceCode(CONFIG)).rejects.toThrow("no seat");
  });

  it("throws when flow_id / authorize_url are missing", async () => {
    installFetch(async () => jsonResponse({ code: 0, data: { flow_id: "f" } }));
    await expect(zcodePlan.requestDeviceCode(CONFIG)).rejects.toThrow(/missing flow_id\/authorize_url/);
  });
});

describe("pollToken", () => {
  it("missing poll token → access_denied without any fetch", async () => {
    const fetchMock = installFetch(async () => jsonResponse({}));
    const out = await zcodePlan.pollToken(CONFIG, "flow-1", null, {});
    expect(out.ok).toBe(true);
    expect(out.data.error).toBe("access_denied");
    expect(out.data.error_description).toContain("Missing ZCode poll token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pending → authorization_pending; GETs poll/<encoded flow> with the Bearer", async () => {
    const fetchMock = installFetch(async () => jsonResponse({ code: 0, data: { status: "pending" } }));
    const out = await zcodePlan.pollToken(CONFIG, "flow/with space", null, { _zcodePollToken: "tok-1" });
    expect(out).toEqual({ ok: true, data: { error: "authorization_pending" } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CONFIG.cliPollUrl}/${encodeURIComponent("flow/with space")}`);
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("ready with a top-level token (plan JWT) wins over nested zai.access_token and is the chat credential", async () => {
    installFetch(async () =>
      jsonResponse({
        code: 0,
        data: {
          status: "ready",
          token: "plan-jwt",
          user: { name: "Keeper", email: "k@shore.ai", user_id: "u-9" },
          zai: { access_token: "nested-token" },
          expires_at: Math.floor(Date.now() / 1000) + 300,
        },
      }),
    );
    const out = await zcodePlan.pollToken(CONFIG, "flow-1", null, { _zcodePollToken: "tok-1" });
    expect(out.ok).toBe(true);
    expect(out.data.access_token).toBe("plan-jwt");
    expect(out.data._zaiOAuthToken).toBe("nested-token");
    expect(out.data._zcodeUser).toEqual({ name: "Keeper", email: "k@shore.ai", user_id: "u-9" });
    expect(out.data._zcodePollToken).toBe("tok-1");
    expect(out.data._zcodeExpiresIn).toBeGreaterThan(290);
    expect(out.data._zcodeExpiresIn).toBeLessThanOrEqual(300);
  });

  it("ready with a nested-only zai.access_token (no top-level token) → access_denied 'missing plan token'", async () => {
    installFetch(async () =>
      jsonResponse({
        code: 0,
        data: { status: "ready", zai: { access_token: "nested-only" } },
      }),
    );
    const out = await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" });
    expect(out.data.error).toBe("access_denied");
    expect(out.data.error_description).toContain("missing plan token");
    expect(out.data).not.toHaveProperty("access_token");
  });

  it("ready with a top-level access_token (snake) resolves it as the plan token", async () => {
    installFetch(async () => jsonResponse({ code: 0, data: { status: "ready", access_token: "top-snake" } }));
    const out = await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" });
    expect(out.data.access_token).toBe("top-snake");
    expect(out.data._zaiOAuthToken).toBe("");
    expect(out.data._zcodeUser).toEqual({});
  });

  it("ready with a top-level accessToken (camel) resolves it as the plan token", async () => {
    installFetch(async () => jsonResponse({ code: 0, data: { status: "ready", accessToken: "top-camel" } }));
    expect((await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" })).data.access_token).toBe("top-camel");
  });

  it("ready without any plan token → access_denied 'missing plan token'", async () => {
    installFetch(async () => jsonResponse({ code: 0, data: { status: "ready", zai: {} } }));
    const out = await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" });
    expect(out.data.error).toBe("access_denied");
    expect(out.data.error_description).toContain("missing plan token");
  });

  it("failed status → access_denied", async () => {
    installFetch(async () => jsonResponse({ code: 0, data: { status: "failed" } }));
    const out = await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" });
    expect(out.data.error).toBe("access_denied");
    expect(out.data.error_description).toMatch(/failed or was cancelled/);
  });

  it("an unknown status stays pending with a descriptive note", async () => {
    installFetch(async () => jsonResponse({ code: 0, data: { status: "weird" } }));
    const out = await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" });
    expect(out.data.error).toBe("authorization_pending");
    expect(out.data.error_description).toContain("weird");
  });

  it("HTTP failure → access_denied carrying the status", async () => {
    installFetch(async () => jsonResponse("", { ok: false, status: 503 }));
    const out = await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" });
    expect(out.data.error).toBe("access_denied");
    expect(out.data.error_description).toContain("HTTP 503");
  });

  it("a non-success business code → access_denied with its msg", async () => {
    installFetch(async () => jsonResponse({ code: 1005, msg: "seat revoked" }));
    const out = await zcodePlan.pollToken(CONFIG, "f", null, { _zcodePollToken: "t" });
    expect(out.data.error).toBe("access_denied");
    expect(out.data.error_description).toBe("seat revoked");
  });
});

describe("mapTokens", () => {
  it("maps the poll data into the connection credential shape", () => {
    const mapped = zcodePlan.mapTokens({
      access_token: "jwt-abc",
      _zcodeExpiresIn: 600,
      _zcodeUser: { name: "Keeper", email: "k@shore.ai", user_id: "u-1" },
    });

    expect(mapped.accessToken).toBe("jwt-abc");
    expect(mapped.refreshToken).toBe(null);
    expect(mapped.expiresIn).toBe(600);
    expect(mapped.email).toBe("k@shore.ai");
    expect(mapped.displayName).toBe("Keeper");
    expect(mapped.providerSpecificData.authMethod).toBe("cli_poll");
    expect(mapped.providerSpecificData.username).toBe("Keeper");
    expect(mapped.providerSpecificData.userId).toBe("u-1");
    expect(mapped.providerSpecificData.deviceMid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(mapped.providerSpecificData.zcodeUser).toEqual({ name: "Keeper", email: "k@shore.ai", user_id: "u-1" });
  });

  it("persists the ZAI OAuth token in providerSpecificData when the plan payload carried one", () => {
    const withToken = zcodePlan.mapTokens({
      access_token: "plan-jwt",
      _zaiOAuthToken: "zai-oauth",
      _zcodeUser: {},
    });
    expect(withToken.accessToken).toBe("plan-jwt");
    expect(withToken.providerSpecificData.zaiOAuthToken).toBe("zai-oauth");

    const withoutToken = zcodePlan.mapTokens({ access_token: "plan-jwt", _zaiOAuthToken: "", _zcodeUser: {} });
    expect(withoutToken.providerSpecificData).not.toHaveProperty("zaiOAuthToken");
  });

  it("falls back to user.id for userId and to email for displayName", () => {
    const mapped = zcodePlan.mapTokens({
      access_token: "jwt",
      _zcodeUser: { email: "only@mail", id: "u-2" },
    });
    expect(mapped.providerSpecificData.userId).toBe("u-2");
    expect(mapped.displayName).toBe("only@mail");
  });

  it("mints a different deviceMid on every mapping", () => {
    const a = zcodePlan.mapTokens({ access_token: "a", _zcodeUser: {} });
    const b = zcodePlan.mapTokens({ access_token: "b", _zcodeUser: {} });
    expect(a.providerSpecificData.deviceMid).not.toBe(b.providerSpecificData.deviceMid);
  });

  it("omits expiresIn and displayName when absent; email is null", () => {
    const mapped = zcodePlan.mapTokens({ access_token: "jwt" });
    expect(mapped.expiresIn).toBeUndefined();
    expect(mapped.email).toBe(null);
    expect(mapped).not.toHaveProperty("displayName");
    expect(mapped.providerSpecificData.username).toBeUndefined();
  });
});
