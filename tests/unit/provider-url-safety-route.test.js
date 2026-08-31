/**
 * Provider-Test SSRF — route-surface integration proof (M0 TAG 4)
 *
 * Proves the gate is wired at the OPERATOR-CONTROLLED entry points, not in
 * the shared fetch used by internal loopback pings:
 *
 *   R1. testUtils.testApiKeyConnection — OpenAI-compatible + Anthropic-compatible
 *       baseUrl surfaces refuse loopback/metadata BEFORE any fetch leaves.
 *   R2. /api/providers/validate — OpenAI/Anthropic/Custom-Embedding node
 *       baseUrl surfaces return honest 400 refusals.
 *   R3. The internal model-ping path (models/test/ping.js) is untouched —
 *       loopback pings still work (they never touch the gate).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the heavy Next/db imports BEFORE importing the route modules.
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
}));
vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
  getProviderConnections: vi.fn(async () => []),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
const { getProviderConnectionById, updateProviderConnection } = await import("@/lib/localDb");
const { getProviderNodeById } = await import("@/models");
const validateRoute = await import("../../src/app/api/providers/validate/route.js");

describe("R1: testUtils gated surfaces refuse loopback/metadata", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    updateProviderConnection.mockResolvedValue();
  });
  afterEach(() => vi.clearAllMocks());

  it("OpenAI-compatible baseUrl to loopback is refused without fetching", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c1",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "http://127.0.0.1:9999/v1" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c1");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved local range/i);
    // The gate refused BEFORE any network call — no fetch escaped.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Connection is marked in error with the honest refusal.
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ testStatus: "error" })
    );
  });

  it("OpenAI-compatible baseUrl to metadata IP is refused", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c2",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "http://169.254.169.254/latest" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c2");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OpenAI-compatible baseUrl with hostile decimal loopback is refused", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c3",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "http://2130706433/v1" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c3");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OpenAI-compatible baseUrl with file:// scheme is refused", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c4",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "file:///etc/passwd" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c4");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/http:\/\/ or https:\/\//i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OpenAI-compatible baseUrl with unparseable URL is refused", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c5",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "not-a-valid-url" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c5");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/could not be parsed|missing/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Anthropic-compatible baseUrl to loopback is refused without fetching", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c6",
      provider: "anthropic-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "http://[::1]:8080" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c6");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Anthropic-compatible baseUrl with /messages suffix to metadata is refused", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c7",
      provider: "anthropic-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "http://169.254.169.254/messages" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c7");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Azure endpoint to loopback is refused without fetching", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c8",
      provider: "azure",
      authType: "apikey",
      apiKey: "az-test",
      providerSpecificData: { azureEndpoint: "http://localhost:8000" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c8");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("llm7 operator baseUrl to loopback is refused without fetching", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c9",
      provider: "llm7",
      authType: "apikey",
      apiKey: "llm7-test",
      providerSpecificData: { baseUrl: "http://127.0.0.1:11434" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await testSingleConnection("c9");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a public baseUrl passes the gate and the probe fetches /models", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c10",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "https://api.example.com/v1" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });

    const result = await testSingleConnection("c10");

    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.example.com/v1/models");
  });

  it("RFC1918 / Tailscale baseUrl passes the gate (homelab not blocked)", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c11",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "http://100.64.5.20:8085/v1" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });

    const result = await testSingleConnection("c11");

    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a redirect hop to metadata fails the test honestly", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "c12",
      provider: "openai-compatible-test",
      authType: "apikey",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "https://evil.example.com/v1" },
    });
    // First fetch: redirect to the metadata IP. With redirect:"manual" the
    // hop-prober must judge the Location and refuse it.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: (k) => (k.toLowerCase() === "location" ? "http://169.254.169.254/latest" : null) },
      body: { cancel: () => {} },
    });

    const result = await testSingleConnection("c12");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/redirect/i);
    // Exactly one fetch — the metadata hop was refused, never followed.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("R2: /api/providers/validate gated surfaces return 400", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.clearAllMocks());

  function makeRequest(body) {
    return { json: async () => body };
  }

  it("OpenAI-compatible node baseUrl to metadata returns 400", async () => {
    getProviderNodeById.mockResolvedValue({ baseUrl: "http://169.254.169.254/latest" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await validateRoute.POST(makeRequest({
      provider: "openai-compatible-test",
      apiKey: "sk-test",
    }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OpenAI-compatible node baseUrl to loopback returns 400", async () => {
    getProviderNodeById.mockResolvedValue({ baseUrl: "http://127.0.0.1:9999/v1" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await validateRoute.POST(makeRequest({
      provider: "openai-compatible-test",
      apiKey: "sk-test",
    }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Anthropic-compatible node baseUrl with file:// returns 400", async () => {
    getProviderNodeById.mockResolvedValue({ baseUrl: "file:///etc/passwd" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await validateRoute.POST(makeRequest({
      provider: "anthropic-compatible-test",
      apiKey: "sk-test",
    }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/http:\/\/ or https:\/\//i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Custom-Embedding node baseUrl to hex loopback returns 400", async () => {
    getProviderNodeById.mockResolvedValue({ baseUrl: "http://0x7f000001/v1" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await validateRoute.POST(makeRequest({
      provider: "custom-embedding-test",
      apiKey: "sk-test",
    }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Azure azureEndpoint to localhost returns 400", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await validateRoute.POST(makeRequest({
      provider: "azure",
      apiKey: "az-test",
      providerSpecificData: { azureEndpoint: "http://localhost:9000" },
    }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved local range/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a public OpenAI-compatible node baseUrl passes and probes /models", async () => {
    getProviderNodeById.mockResolvedValue({ baseUrl: "https://api.example.com/v1" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });

    const res = await validateRoute.POST(makeRequest({
      provider: "openai-compatible-test",
      apiKey: "sk-test",
    }));

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.example.com/v1/models");
  });
});

describe("R3: the internal model-ping loopback path is untouched", () => {
  it("ping.js never imports the SSRF gate and keeps its loopback default", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const pingPath = resolve(__dirname, "../../src/app/api/models/test/ping.js");
    const source = readFileSync(pingPath, "utf8");

    // The internal ping must NOT route through the gate — loopback pings are
    // its whole purpose and the default baseUrl proves it.
    expect(source).not.toMatch(/providerUrlSafety/);
    expect(source).toMatch(/http:\/\/127\.0\.0\.1/);

    // And the gate's bypass flag behaves for any future internal caller:
    // loopback passes with allowLocalLoopback (operator routes never set it).
    const { validateProviderTestUrl } = await import("../../src/lib/network/providerUrlSafety.js");
    expect(
      validateProviderTestUrl("http://127.0.0.1:32060/api/v1/chat/completions", { allowLocalLoopback: true }).ok
    ).toBe(true);
    expect(validateProviderTestUrl("http://127.0.0.1:32060/api/v1/chat/completions").ok).toBe(false);
  });
});
