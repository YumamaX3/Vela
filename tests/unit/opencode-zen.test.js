/**
 * OpenCode Zen rebrand (v0.6.41) — registry invariants, executor hybrid auth
 * headers, and the hybrid freeTier noAuth lane in getProviderCredentials.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import opencode from "../../open-sse/providers/registry/opencode.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

// ── hybrid-lane harness (mocks hoisted; auth.js imported at top level) ─────
const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: null,
    connectionNoProxy: false,
    connectionProxyPoolId: null,
    vercelRelayUrl: "",
  })),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: { "plain-free": { noAuth: true } },
  FREE_TIER_PROVIDERS: { zen: { noAuth: true }, "plain-tier": {} },
  resolveProviderId: (p) => p,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

describe("OpenCode Zen registry rebrand", () => {
  it("renames the provider and moves it into the freeTier category", () => {
    expect(opencode.display.name).toBe("OpenCode Zen");
    expect(opencode.category).toBe("freeTier");
  });

  it("declares apikey auth while keeping the noAuth hybrid marker", () => {
    expect(opencode.authType).toBe("apikey");
    expect(opencode.authModes).toEqual(["apikey"]);
    expect(opencode.noAuth).toBe(true);
    expect(opencode.display.notice.apiKeyUrl).toBe("https://opencode.ai/auth");
  });

  it("preserves the stable wire identity — id, alias, transport", () => {
    expect(opencode.id).toBe("opencode");
    expect(opencode.alias).toBe("oc");
    expect(opencode.transport.baseUrl).toBe("https://opencode.ai");
    expect(opencode.transport.noAuth).toBe(true);
    expect(opencode.modelsFetcher.url).toBe("https://opencode.ai/zen/v1/models");
  });

  it("appears in the dashboard freeTier catalog, not the free catalog", async () => {
    const { FREE_PROVIDERS, FREE_TIER_PROVIDERS } = await vi.importActual(
      "../../src/shared/constants/providers.js"
    );
    expect(FREE_TIER_PROVIDERS["opencode"]?.authModes).toEqual(["apikey"]);
    expect(FREE_TIER_PROVIDERS["opencode"]?.name).toBe("OpenCode Zen");
    expect(FREE_PROVIDERS["opencode"]).toBeUndefined();
  });
});

describe("OpenCodeExecutor hybrid auth headers", () => {
  const ex = new OpenCodeExecutor();

  const headerFor = (credentials, stream = true) => ex.buildHeaders(credentials, stream);

  it("sends Bearer public for the keyless virtual connection", () => {
    expect(headerFor({ accessToken: "public" }).Authorization).toBe("Bearer public");
    expect(headerFor(null).Authorization).toBe("Bearer public");
    expect(headerFor({}).Authorization).toBe("Bearer public");
    expect(headerFor({ apiKey: "" }).Authorization).toBe("Bearer public");
    expect(headerFor({ apiKey: "public" }).Authorization).toBe("Bearer public");
  });

  it("sends the connection API key when one is present", () => {
    expect(headerFor({ apiKey: "zen-key-123" }).Authorization).toBe("Bearer zen-key-123");
  });

  it("prefers apiKey over accessToken and treats a real accessToken as a key", () => {
    expect(headerFor({ apiKey: "key-a", accessToken: "tok-b" }).Authorization).toBe("Bearer key-a");
    expect(headerFor({ accessToken: "real-token" }).Authorization).toBe("Bearer real-token");
  });

  it("keeps the opencode session header family intact in both lanes", () => {
    for (const cred of [{ apiKey: "zen-key" }, { accessToken: "public" }]) {
      const h = headerFor(cred);
      expect(h["x-opencode-client"]).toBe("desktop");
      expect(h["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
      expect(h["x-opencode-request"]).toMatch(/^msg_[0-9a-f]{32}$/);
      expect(h["x-opencode-project"]).toBe("global");
      expect(h["User-Agent"]).toBe("opencode");
      expect(h["Content-Type"]).toBe("application/json");
      expect(h.Accept).toBe("text/event-stream");
    }
    expect(headerFor({}, false).Accept).toBe("*/*");
  });
});

describe("hybrid freeTier noAuth lane in getProviderCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getSettings.mockResolvedValue({ providerStrategies: {} });
    dbMocks.getProxyPools.mockResolvedValue([]);
  });

  it("injects the virtual Public connection when a noAuth freeTier provider has no active connections", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([]);
    const creds = await getProviderCredentials("zen");
    expect(creds).toMatchObject({ id: "noauth", connectionName: "Public", accessToken: "public" });
  });

  it("uses the real apikey connection when one exists — never the virtual lane", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "zen-key-conn", provider: "zen", authType: "apikey", apiKey: "zen-key-abc", isActive: true },
    ]);
    const creds = await getProviderCredentials("zen");
    expect(creds.connectionId).toBe("zen-key-conn");
    expect(creds.apiKey).toBe("zen-key-abc");
    expect(creds.id ?? creds.connectionId).not.toBe("noauth");
  });

  it("does NOT inject a virtual connection for a plain freeTier provider without noAuth", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([]);
    const creds = await getProviderCredentials("plain-tier");
    expect(creds).toBeNull();
  });

  it("keeps the category free lane unconditional (regression guard)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "should-be-ignored", provider: "plain-free", isActive: true },
    ]);
    const creds = await getProviderCredentials("plain-free");
    expect(creds).toMatchObject({ id: "noauth", accessToken: "public" });
    // The virtual lane short-circuits before any DB scan for category free.
    expect(dbMocks.getProviderConnections).not.toHaveBeenCalled();
  });
});
