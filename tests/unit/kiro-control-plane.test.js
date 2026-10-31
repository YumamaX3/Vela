/**
 * M3 · C3 — the Kiro control plane: the pinned request SHAPE, the account-order
 * merge, the 30-minute memo, the default-OFF flag, and the per-account gate.
 *
 * The plan's headline: /v1/models derives from `ListAvailableModels`
 * (`x-amz-target: KiroControlPlaneBearerService.ListAvailableModels`) per
 * account, merged in ACCOUNT ORDER (stable), refreshed every 30 minutes, and a
 * per-account model list GATES selection. The request shape is pinned here so
 * flipping the flag can never change it silently.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  KIRO_CONTROL_PLANE_TTL_MS,
  attachKiroAvailability,
  buildKiroControlPlaneRequest,
  deriveKiroCatalog,
  fetchKiroControlPlaneModels,
  getKiroAccountModelCatalog,
  invalidateKiroControlPlaneCache,
  isKiroControlPlaneEnabled,
  kiroAvailablePublicIds,
  selectKiroModelForAccount,
} from "open-sse/services/kiroControlPlane.js";
import { KIRO_CONTROL_PLANE_TARGET } from "open-sse/config/kiroConstants.js";
import { resolveKiroModelIntent } from "open-sse/config/kiroConstants.js";

const CREDS = Object.freeze({
  accessToken: "tok-abc",
  refreshToken: "rt-abc",
  providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC", authMethod: "builder-id" },
});

beforeEach(() => {
  delete process.env.KIRO_CONTROL_PLANE;
  invalidateKiroControlPlaneCache();
});

afterEach(() => {
  delete process.env.KIRO_CONTROL_PLANE;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("default-OFF flag", () => {
  it("is off unless explicitly turned on", () => {
    expect(isKiroControlPlaneEnabled({})).toBe(false);
    expect(isKiroControlPlaneEnabled({ KIRO_CONTROL_PLANE: "" })).toBe(false);
    expect(isKiroControlPlaneEnabled({ KIRO_CONTROL_PLANE: "0" })).toBe(false);
    expect(isKiroControlPlaneEnabled({ KIRO_CONTROL_PLANE: "off" })).toBe(false);
    expect(isKiroControlPlaneEnabled({ KIRO_CONTROL_PLANE: "on" })).toBe(true);
    expect(isKiroControlPlaneEnabled({ KIRO_CONTROL_PLANE: "1" })).toBe(true);
    expect(isKiroControlPlaneEnabled({ KIRO_CONTROL_PLANE: "true" })).toBe(true);
  });

  it("never fetches while the flag is off (no network, no gate)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const catalog = await getKiroAccountModelCatalog(CREDS, { log: console });
    expect(catalog).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    // And the translator gate is inert on the same credentials.
    expect(resolveKiroModelIntent("claude-sonnet-5", CREDS)).toMatchObject({ available: true });
  });
});

describe("the pinned request shape", () => {
  it("carries the control-plane target in x-amz-target on the host root", () => {
    const { url, headers } = buildKiroControlPlaneRequest(CREDS);
    expect(KIRO_CONTROL_PLANE_TARGET).toBe("KiroControlPlaneBearerService.ListAvailableModels");
    expect(url).toBe("https://runtime.us-east-1.kiro.dev/");
    expect(headers["X-Amz-Target"]).toBe("KiroControlPlaneBearerService.ListAvailableModels");
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["amz-sdk-request"]).toBe("attempt=1; max=1");
    expect(headers["amz-sdk-invocation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    // Never the streaming target, never a /ListAvailableModels path.
    expect(headers["X-Amz-Target"]).not.toContain("GenerateAssistantResponse");
    expect(url).not.toContain("ListAvailableModels");
  });

  it("never leaks the token into the URL", () => {
    const { url } = buildKiroControlPlaneRequest(CREDS);
    expect(url).not.toContain("tok-abc");
  });

  it("moves the host ladder with the profile's region", () => {
    const creds = { ...CREDS, providerSpecificData: { ...CREDS.providerSpecificData, profileArn: "arn:aws:codewhisperer:eu-west-1:1:profile/X" } };
    expect(buildKiroControlPlaneRequest(creds).url).toBe("https://runtime.eu-west-1.kiro.dev/");
    expect(buildKiroControlPlaneRequest(creds, { hostIndex: 2 }).url).toBe("https://q.eu-west-1.amazonaws.com/");
  });

  it("stamps the API_KEY / EXTERNAL_IDP token type the auth method implies", () => {
    const apiKey = buildKiroControlPlaneRequest({ ...CREDS, providerSpecificData: { ...CREDS.providerSpecificData, authMethod: "api_key" } });
    expect(apiKey.headers.TokenType).toBe("API_KEY");
    const idp = buildKiroControlPlaneRequest({ ...CREDS, providerSpecificData: { ...CREDS.providerSpecificData, authMethod: "external_idp" } });
    expect(idp.headers.TokenType).toBe("EXTERNAL_IDP");
    expect(buildKiroControlPlaneRequest(CREDS).headers.TokenType).toBeUndefined();
  });

  it("sends POST with an empty JSON body to the first host", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ models: [{ modelId: "claude-sonnet-5" }] }), { status: 200 }));
    const result = await fetchKiroControlPlaneModels(CREDS, { fetchImpl: fetchSpy });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://runtime.us-east-1.kiro.dev/");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.headers["X-Amz-Target"]).toBe(KIRO_CONTROL_PLANE_TARGET);
    expect(result.entries).toEqual([{ modelId: "claude-sonnet-5", modelName: "" }]);
  });

  it("fails over to the next host on a non-2xx, keeping the same shape", async () => {
    const seen = [];
    const fetchSpy = vi.fn(async (url) => {
      seen.push(url);
      if (seen.length === 1) return new Response("nope", { status: 503 });
      return new Response(JSON.stringify({ availableModels: ["claude-opus-5"] }), { status: 200 });
    });
    const result = await fetchKiroControlPlaneModels(CREDS, { fetchImpl: fetchSpy });
    expect(seen).toEqual([
      "https://runtime.us-east-1.kiro.dev/",
      "https://codewhisperer.us-east-1.amazonaws.com/",
    ]);
    expect(result.entries).toEqual([{ modelId: "claude-opus-5", modelName: "" }]);
  });
});

describe("account-order merge (stable)", () => {
  it("keeps the first account's order and appends only new ids", () => {
    const merged = deriveKiroCatalog([
      [{ modelId: "claude-sonnet-5" }, { modelId: "claude-haiku-4.5" }],
      [{ modelId: "claude-haiku-4.5" }, { modelId: "auto" }],
    ]);
    expect(merged.rawModels.map((m) => m.modelId)).toEqual(["claude-sonnet-5", "claude-haiku-4.5", "auto"]);
    expect(merged.models.map((m) => m.id)).toEqual([
      "claude-sonnet-5", "claude-sonnet-5-thinking", "claude-sonnet-5-agentic", "claude-sonnet-5-thinking-agentic",
      "claude-haiku-4.5", "claude-haiku-4.5-thinking", "claude-haiku-4.5-agentic", "claude-haiku-4.5-thinking-agentic",
      // auto gets no -agentic variants, exactly like kiroModels.js
      "auto", "auto-thinking",
    ]);
  });

  it("is deterministic across repeated calls with the same sources", () => {
    const sources = [[{ modelId: "glm-5" }], [{ modelId: "auto" }]];
    expect(deriveKiroCatalog(sources)).toEqual(deriveKiroCatalog(sources));
  });

  it("returns null when every source is empty (no evidence, no gate)", () => {
    expect(deriveKiroCatalog([])).toBeNull();
    expect(deriveKiroCatalog([[], null, undefined])).toBeNull();
  });
});

describe("30-minute memo", () => {
  it("pins the TTL to 30 minutes", () => {
    expect(KIRO_CONTROL_PLANE_TTL_MS).toBe(30 * 60 * 1000);
  });

  it("fetches once, then serves the memo until it expires", async () => {
    process.env.KIRO_CONTROL_PLANE = "on";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ models: [{ modelId: "claude-opus-5" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    const first = await getKiroAccountModelCatalog(CREDS);
    const second = await getKiroAccountModelCatalog(CREDS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.available.has("claude-opus-5")).toBe(true);
    expect(second).toBe(first);

    spy.mockReturnValue(now + KIRO_CONTROL_PLANE_TTL_MS + 1);
    await getKiroAccountModelCatalog(CREDS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache a failure — the next call tries again", async () => {
    process.env.KIRO_CONTROL_PLANE = "on";
    const fetchSpy = vi.fn(async () => new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getKiroAccountModelCatalog(CREDS)).toBeNull();
    expect(await getKiroAccountModelCatalog(CREDS)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(6); // 3 hosts per attempt x 2 attempts
  });
});

describe("per-account gate", () => {
  it("passes everything when there is no evidence", () => {
    expect(selectKiroModelForAccount("claude-opus-5", null)).toEqual({ ok: true, model: "claude-opus-5" });
    expect(selectKiroModelForAccount("claude-opus-5", new Set())).toEqual({ ok: true, model: "claude-opus-5" });
  });

  it("accepts a model the account lists — through the enum, the alias, and the suffix", () => {
    const available = new Set(["claude-sonnet-4.5"]);
    expect(selectKiroModelForAccount("claude-sonnet-4.5-thinking-agentic", available).ok).toBe(true);
    expect(selectKiroModelForAccount("claude-sonnet-4-5", available).ok).toBe(true);
    expect(selectKiroModelForAccount("CLAUDE_SONNET_4_5_V1_0", available).ok).toBe(true);
    expect(selectKiroModelForAccount("claude-3-5-sonnet", new Set(["claude-sonnet-5"])).ok).toBe(true);
  });

  it("declines a model the account does not list, carrying the list for the 400", () => {
    const out = selectKiroModelForAccount("claude-opus-5", new Set(["claude-sonnet-4.5"]));
    expect(out).toEqual({ ok: false, reason: "kiro_model_not_in_account", available: ["claude-sonnet-4.5"] });
  });

  it("gates the translator through credentials.kiroAvailableModels — 400, never a 500", async () => {
    process.env.KIRO_CONTROL_PLANE = "on";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ modelId: "claude-sonnet-4.5" }] }), { status: 200 })));
    const credentials = { ...CREDS, providerSpecificData: { ...CREDS.providerSpecificData } };
    await attachKiroAvailability(credentials, { forceRefresh: true });

    expect(resolveKiroModelIntent("claude-opus-5", credentials)).toMatchObject({
      available: false,
      unavailableReason: "kiro_model_not_in_account",
    });
    expect(resolveKiroModelIntent("claude-sonnet-4.5", credentials)).toMatchObject({ available: true });
    // Public spellings for the error body.
    expect(kiroAvailablePublicIds(credentials.kiroAvailableModels)).toEqual(["claude-sonnet-4.5"]);
  });

  it("leaves credentials untouched when the flag is off", async () => {
    const credentials = { ...CREDS, providerSpecificData: { ...CREDS.providerSpecificData } };
    await attachKiroAvailability(credentials);
    expect("kiroAvailableModels" in credentials).toBe(false);
  });
});
