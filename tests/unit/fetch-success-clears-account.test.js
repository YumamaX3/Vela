import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getCombos: vi.fn(),
  handleFetchCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getCombos: mocks.getCombos,
}));

vi.mock("open-sse/handlers/fetch/index.js", () => ({
  handleFetchCore: mocks.handleFetchCore,
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));

vi.mock("@/shared/utils/ssrfGuard.js", () => ({
  // ab938d3a upgraded the handler to the DNS-resolving guard; the suite's
  // mock still bound only assertPublicUrl, so the real resolver ran and the
  // happy path 400'd before reaching the account-state assertions.
  assertPublicUrl: vi.fn(),
  assertPublicUrlResolved: vi.fn(async () => {}),
}));

import { handleFetch } from "@/sse/handlers/fetch.js";

describe("web fetch account state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getCombos.mockResolvedValue([]);
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "jina-test-key",
      connectionId: "jina-connection",
      connectionName: "Jina Test",
      _connection: {
        testStatus: "unavailable",
        lastError: "old error",
        modelLock___all: "2026-01-01T00:00:00.000Z",
      },
    });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
    mocks.handleFetchCore.mockResolvedValue({
      success: true,
      data: { provider: "jina-reader", content: { text: "ok" } },
    });
  });

  it("clears a stale provider lock after a successful fetch", async () => {
    const response = await handleFetch(new Request("http://localhost/v1/web/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "jina-reader",
        url: "https://example.com/article",
      }),
    }));

    expect(response.status).toBe(200);
    // ab938d3a added the capability-scoped lock key as the third argument.
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "jina-connection",
      expect.objectContaining({ connectionName: "Jina Test" }),
      "webfetch:jina-reader",
    );
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
