/**
 * ADR-004 M2 (upstream f6e7cabe rebased) — the cline/clinepass token-refresh
 * dispatch. Vela's REFRESH_HANDLERS carried NEITHER provider before this
 * stone: getAccessToken("cline", …) logged "Unsupported provider" and
 * returned null, so Cline AND ClinePass OAuth tokens could never rotate — a
 * silent permanent-401 class (upstream names the clinepass half; the cline
 * half was Vela's own gap). This suite pins the fixed dispatch at the seam:
 * the POST shape WorkOS expects, the {data} envelope unwrap, and honest null
 * on failure. Each test uses a distinct refresh token — dedupRefresh caches
 * in-flight work per (provider, token).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const load = async () => {
  const mod = await import("../../open-sse/services/tokenRefresh.js");
  return mod;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function fetchStub(capture, response) {
  return vi.fn(async (url, init) => {
    capture.url = url;
    capture.init = init;
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 401),
      text: async () => JSON.stringify(response.body),
      json: async () => response.body,
    };
  });
}

describe("cline/clinepass refresh dispatch", () => {
  it("cline routes through REFRESH_HANDLERS with the WorkOS refresh shape", async () => {
    const capture = {};
    vi.stubGlobal("fetch", fetchStub(capture, {
      ok: true,
      body: { data: { accessToken: "AT-new", refreshToken: "RT-next", expiresAt: new Date(Date.now() + 3600_000).toISOString() } },
    }));
    const mod = await load();
    const out = await mod.getAccessToken("cline", { refreshToken: "RT-cline-1", accessToken: "old" }, null);
    expect(capture.url).toContain("api.cline.bot");
    const body = JSON.parse(capture.init.body);
    expect(body).toEqual({ refreshToken: "RT-cline-1", grantType: "refresh_token", clientType: "extension" });
    // envelope unwrapped; expiry derived from expiresAt
    expect(out.accessToken).toBe("AT-new");
    expect(out.refreshToken).toBe("RT-next");
    expect(out.expiresIn).toBeGreaterThan(3000);
  });

  it("clinepass shares the same WorkOS endpoint", async () => {
    const capture = {};
    vi.stubGlobal("fetch", fetchStub(capture, {
      ok: true,
      body: { data: { accessToken: "AT-cp", refreshToken: "RT-cp2", expiresIn: 7200 } },
    }));
    const mod = await load();
    const out = await mod.getAccessToken("clinepass", { refreshToken: "RT-cp-1", accessToken: "old" }, null);
    expect(capture.url).toContain("api.cline.bot");
    expect(out.accessToken).toBe("AT-cp");
    expect(out.expiresIn).toBe(7200); // expiresIn fallback honored
  });

  it("a failed refresh is honest null — and reaches the log, not a throw", async () => {
    const capture = {};
    vi.stubGlobal("fetch", fetchStub(capture, { ok: false, status: 401, body: { error: "invalid_grant" } }));
    const mod = await load();
    const warn = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const out = await mod.getAccessToken("cline", { refreshToken: "RT-fail-1", accessToken: "old" }, warn);
    expect(out).toBeNull();
    expect(warn.error).toHaveBeenCalledWith("TOKEN_REFRESH", "Failed to refresh Cline token", expect.objectContaining({ status: 401 }));
  });

  it("flat (un-enveloped) responses still parse — the unwrap is permissive", async () => {
    const capture = {};
    vi.stubGlobal("fetch", fetchStub(capture, {
      ok: true,
      body: { accessToken: "AT-flat", refreshToken: "RT-flat", expiresIn: 900 },
    }));
    const mod = await load();
    const out = await mod.getAccessToken("cline", { refreshToken: "RT-flat-1", accessToken: "old" }, null);
    expect(out.accessToken).toBe("AT-flat");
  });

  it("a network throw degrades to null (never crashes the request lane)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket died"); }));
    const mod = await load();
    const warn = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const out = await mod.getAccessToken("cline", { refreshToken: "RT-throw-1", accessToken: "old" }, warn);
    expect(out).toBeNull();
    expect(warn.error).toHaveBeenCalledWith("TOKEN_REFRESH", expect.stringContaining("socket died"));
  });
});
