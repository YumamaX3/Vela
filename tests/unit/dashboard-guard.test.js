import { describe, it, expect, vi, beforeEach } from "vitest";
import { timingSafeEqual } from "../../src/shared/utils/timingSafeEqual.js";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  AUTH_COOKIE_NAME: "vela_auth_token",
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

const PEER_TOKEN = "peer-token-fixture";

function request(pathname, headers = {}) {
  const normalizedHeaders = new Headers(headers);
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

// A request that actually came through custom-server.js: peer IP stamped from the TCP
// socket and proven by the per-process secret.
function localRequest(pathname, headers = {}) {
  return request(pathname, { "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": "127.0.0.1", ...headers });
}

describe("dashboard guard public LLM API access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows loopback public LLM API without API key", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", { host: "localhost:32060" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote Host-spoof when real peer IP is non-loopback", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", {
      host: "localhost",
      "x-9r-real-ip": "10.204.111.34",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback peer IP regardless of Host", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", {
      host: "localhost:32060",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback rewritten public LLM API without API key", async () => {
    const response = await proxy(localRequest("/api/v1/chat/completions", { host: "localhost:32060" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote beta public LLM API without API key", async () => {
    const response = await proxy(request("/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote rewritten beta public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote codex rewrite without API key", async () => {
    const response = await proxy(request("/codex/x", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows remote codex rewrite with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/codex/x", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid bearer API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid x-api-key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/web/fetch", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote rewritten beta public LLM API with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1beta/models", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google API key header", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models", {
      host: "router.example.com",
      "x-goog-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("rejects remote beta public LLM API key supplied via ?key= query parameter", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models?key=vela-valid", {
      host: "router.example.com",
    }));

    // Governance decree: ?key= is dead — keys in URLs leak into logs, browser
    // history, and Referrer headers. Rejected at the middleware with an honest
    // code, before the key is ever validated.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("query_param_key_rejected");
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });
});

describe("dashboard guard local-only access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("rejects local-only route from non-loopback host without CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("rejects local-only route on loopback when requireLogin=true and no JWT", async () => {
    const response = await proxy(localRequest("/api/mcp/filesystem/sse", {
      host: "localhost:32060",
      origin: "http://localhost:32060",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("allows local-only route on loopback when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(localRequest("/api/cli-tools/antigravity-mitm", {
      host: "localhost:32060",
      origin: "http://localhost:32060",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects local-only route from tunnel host even when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("rejects local-only route when Origin is non-loopback (CSRF block)", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(localRequest("/api/cli-tools/antigravity-mitm", {
      host: "localhost:32060",
      origin: "http://evil.example.com",
    }));

    expect(response.status).toBe(403);
  });

  // Updated by CLI Rebirth M0 Tag 1: this case previously asserted success —
  // it encoded the vulnerability (machine token admitted from any origin).
  // The machine token is now LOCAL-BOUND: a remote origin presenting it is 403.
  it("rejects local-only route from a remote origin even with a valid CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
      "x-vela-cli-token": "cli-token",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });
});

describe("dashboard guard helpers", () => {
  it("extracts bearer API keys before x-api-key", () => {
    const apiRequest = request("/v1/chat/completions", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("bearer-key");
  });

  it("extracts Google API keys after x-api-key", () => {
    const apiRequest = request("/v1beta/models?key=query-key", {
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("header-key");
  });
});

describe("timingSafeEqual helper (house pattern)", () => {
  it("matches equal secrets", () => {
    expect(timingSafeEqual("the-machine-token", "the-machine-token")).toBe(true);
  });

  it("rejects mismatched secrets", () => {
    expect(timingSafeEqual("the-machine-token", "the-machine-tokan")).toBe(false);
  });

  it("rejects wrong-length input gracefully (no throw)", () => {
    expect(timingSafeEqual("short", "a-much-longer-secret-value")).toBe(false);
    expect(timingSafeEqual("a-much-longer-secret-value", "short")).toBe(false);
  });

  it("rejects absent/empty/non-string input gracefully (no throw)", () => {
    expect(timingSafeEqual("", "secret")).toBe(false);
    expect(timingSafeEqual("secret", "")).toBe(false);
    expect(timingSafeEqual(undefined, "secret")).toBe(false);
    expect(timingSafeEqual(null, "secret")).toBe(false);
    expect(timingSafeEqual(12345, "12345")).toBe(false);
  });
});

describe("dashboard guard — machine token is locality-bound (CLI Rebirth M0 Tag 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  // Seam 1 — the public LLM API plane (/v1): the most dangerous seam.
  it("rejects a remote origin presenting only the machine token on /v1", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "router.example.com",
      "x-vela-cli-token": "cli-token",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Forbidden: CLI token is only accepted from local origins");
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("still admits the machine token on /v1 from a local origin", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", {
      "x-vela-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("a valid API key still admits a remote caller who also carries a machine token", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/chat/completions", {
      host: "router.example.com",
      "x-vela-cli-token": "cli-token",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  // Seam 2 — LOCAL_ONLY routes (the remote rejection lives in the local-only
  // describe above; here we pin that the local machine token keeps its scope).
  it("still admits the machine token on LOCAL_ONLY routes from a local origin", async () => {
    const response = await proxy(localRequest("/api/mcp/filesystem/sse", {
      "x-vela-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  // Seam 3 — ALWAYS_PROTECTED routes.
  it("rejects a remote origin presenting only the machine token on an ALWAYS_PROTECTED route", async () => {
    const response = await proxy(request("/api/shutdown", {
      host: "router.example.com",
      "x-vela-cli-token": "cli-token",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Forbidden: CLI token is only accepted from local origins");
  });

  it("still admits the machine token on ALWAYS_PROTECTED routes from a local origin", async () => {
    const response = await proxy(localRequest("/api/shutdown", {
      "x-vela-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("a valid JWT still admits a remote caller who also carries a machine token (ALWAYS_PROTECTED)", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    const apiRequest = request("/api/shutdown", {
      host: "router.example.com",
      "x-vela-cli-token": "cli-token",
    });
    apiRequest.cookies = { get: (name) => (name === "vela_auth_token" ? { value: "jwt-ok" } : undefined) };

    const response = await proxy(apiRequest);

    expect(response).toBe(mocks.nextResponse);
  });

  // Seam 4 — deny-by-default /api/* protected routes.
  it("rejects a remote origin presenting only the machine token on a protected /api route", async () => {
    const response = await proxy(request("/api/settings", {
      host: "router.example.com",
      "x-vela-cli-token": "cli-token",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Forbidden: CLI token is only accepted from local origins");
  });

  it("still admits the machine token on protected /api routes from a local origin", async () => {
    const response = await proxy(localRequest("/api/settings", {
      "x-vela-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  // Timing-safe compare graceful degradation at the guard level.
  it("handles a wrong-length CLI token without throwing (remote stays 403)", async () => {
    const response = await proxy(request("/api/keys", {
      host: "router.example.com",
      "x-vela-cli-token": "much-longer-than-the-machine-token",
    }));

    expect(response.status).toBe(403);
  });

  it("handles a wrong-length CLI token without throwing (local falls through to 401)", async () => {
    const response = await proxy(localRequest("/api/keys", {
      "x-vela-cli-token": "short",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  it("treats a wrong-length peer token as untrusted — no locality, no throw", async () => {
    const response = await proxy(request("/v1/models", {
      host: "localhost:32060",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "short",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });
});
