/**
 * W6 · Account hygiene — claudeHeaderCache unit tests
 * (plan `2026-09-20-sibling-harbor-ports` §3.1 row 8, FR-8; security §5a).
 *
 * Covers:
 *   - capture/retrieval of the REAL Claude Code client identity headers;
 *   - the SECURITY invariant: a captured UA is stored, and `authorization` /
 *     `x-api-key` / `cookie` are NEVER stored, logged, or forwarded;
 *   - the executor integration: the captured fingerprint replaces the
 *     fabricated `claude-cli/<ver>` UA on the wire, and cold start keeps it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

async function freshCache() {
  vi.resetModules();
  return await import("open-sse/utils/claudeHeaderCache.js");
}

describe("claudeHeaderCache · capture", () => {
  let cache;
  beforeEach(async () => {
    cache = await freshCache();
  });

  it("returns null before any headers are cached (cold start)", () => {
    expect(cache.getCachedClaudeHeaders()).toBeNull();
  });

  it("stores a captured UA from a claude-code client", () => {
    const ok = cache.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63 node/24.3.0",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "x-app": "cli",
      "x-stainless-os": "MacOS",
      "x-stainless-arch": "arm64",
      // Non-identity header — must not be captured.
      "content-type": "application/json",
    });
    expect(ok).toBe(true);
    const cached = cache.getCachedClaudeHeaders();
    expect(cached["user-agent"]).toBe("claude-code/2.1.63 node/24.3.0");
    expect(cached["x-stainless-os"]).toBe("MacOS");
    expect(cached["content-type"]).toBeUndefined();
  });

  it("recognises claude-cli UA and x-app:cli clients", () => {
    expect(cache.cacheClaudeHeaders({ "user-agent": "claude-cli/1.0.0" })).toBe(true);
    cache.clearCachedClaudeHeaders();
    expect(cache.cacheClaudeHeaders({ "user-agent": "axios/1.7.0", "x-app": "cli" })).toBe(true);
  });

  it("does NOT capture non-Claude clients", () => {
    expect(cache.cacheClaudeHeaders({ "user-agent": "PostmanRuntime/7.43.0" })).toBe(false);
    expect(cache.getCachedClaudeHeaders()).toBeNull();
  });

  it("ignores null / non-object input", () => {
    expect(cache.cacheClaudeHeaders(null)).toBe(false);
    expect(cache.cacheClaudeHeaders(undefined)).toBe(false);
    expect(cache.cacheClaudeHeaders("string")).toBe(false);
    expect(cache.getCachedClaudeHeaders()).toBeNull();
  });

  it("accepts a Headers instance", () => {
    const h = new Headers({
      "user-agent": "claude-code/2.1.63",
      "anthropic-version": "2023-06-01",
    });
    expect(cache.cacheClaudeHeaders(h)).toBe(true);
    expect(cache.getCachedClaudeHeaders()["user-agent"]).toBe("claude-code/2.1.63");
  });

  it("refreshes the cache on each matching request", () => {
    cache.cacheClaudeHeaders({ "user-agent": "claude-code/2.0.0" });
    cache.cacheClaudeHeaders({ "user-agent": "claude-code/2.1.63" });
    expect(cache.getCachedClaudeHeaders()["user-agent"]).toBe("claude-code/2.1.63");
  });

  it("returns a copy, so a caller cannot mutate the singleton", () => {
    cache.cacheClaudeHeaders({ "user-agent": "claude-code/2.1.63" });
    const a = cache.getCachedClaudeHeaders();
    a["user-agent"] = "tampered";
    expect(cache.getCachedClaudeHeaders()["user-agent"]).toBe("claude-code/2.1.63");
  });
});

describe("claudeHeaderCache · SECURITY: credentials are never stored", () => {
  let cache;
  beforeEach(async () => {
    cache = await freshCache();
  });

  it("never stores authorization / x-api-key / cookie / set-cookie", () => {
    const ok = cache.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63 node/24.3.0",
      "x-app": "cli",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "claude-code-20250219",
      // Credential-bearing — every one of these must be dropped.
      "authorization": "Bearer sk-ant-oat01-SECRET",
      "x-api-key": "sk-ant-api03-SECRET",
      "cookie": "sessionKey=SECRET",
      "set-cookie": "sessionKey=SECRET",
      "proxy-authorization": "Basic SECRET",
    });
    expect(ok).toBe(true);

    const cached = cache.getCachedClaudeHeaders();
    expect(cached["user-agent"]).toBe("claude-code/2.1.63 node/24.3.0");
    for (const key of ["authorization", "x-api-key", "cookie", "set-cookie", "proxy-authorization"]) {
      expect(cached[key]).toBeUndefined();
    }
    // And the secret strings must appear nowhere in the cached shape.
    const serialized = JSON.stringify(cached);
    expect(serialized).not.toContain("SECRET");
  });

  it("the identity allow-list is closed: it contains no credential header", () => {
    for (const header of ["authorization", "x-api-key", "cookie", "set-cookie", "proxy-authorization"]) {
      expect(cache.CLAUDE_IDENTITY_HEADER_ALLOWLIST).not.toContain(header);
      expect(cache.CLAUDE_CREDENTIAL_HEADER_DENYLIST).toContain(header);
    }
  });

  it("never logs a header value — only a count", () => {
    const lines = [];
    const log = { debug: (m) => lines.push(m), info: (m) => lines.push(m) };
    cache.cacheClaudeHeaders(
      {
        "user-agent": "claude-code/2.1.63",
        "authorization": "Bearer sk-ant-oat01-SECRET",
        "cookie": "sessionKey=SECRET",
      },
      { log },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Cached");
    expect(lines[0]).not.toContain("SECRET");
    expect(lines[0]).not.toContain("claude-code/2.1.63");
    expect(lines[0]).not.toContain("sk-ant");
  });
});

describe("claudeHeaderCache · executor integration (FR-8)", () => {
  it("replaces the fabricated claude-cli UA with the captured one", async () => {
    vi.resetModules();
    const cache = await import("open-sse/utils/claudeHeaderCache.js");
    cache.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63 node/24.3.0",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "x-app": "cli",
      "x-stainless-package-version": "0.74.0",
    });
    const mod = await import("open-sse/executors/default.js");
    const DefaultExecutor = mod.DefaultExecutor || mod.default;

    const headers = new DefaultExecutor("claude").buildHeaders({ apiKey: "sk-test" }, true);

    expect(headers["user-agent"]).toBe("claude-code/2.1.63 node/24.3.0");
    // Title-Case twin of an overlaid lowercase key must be gone.
    expect(headers["User-Agent"]).toBeUndefined();
    expect(headers["x-app"]).toBe("cli");
    expect(headers["X-App"]).toBeUndefined();
    expect(headers["x-stainless-package-version"]).toBe("0.74.0");
    // Beta is UNIONed: the client's flags AND the ones Vela requires survive.
    const beta = headers["Anthropic-Beta"] || headers["anthropic-beta"];
    const flags = beta.split(",").map((s) => s.trim());
    expect(flags).toContain("oauth-2025-04-20");
    expect(flags).toContain("context-management-2025-06-27");
    expect(flags).toContain("prompt-caching-scope-2026-01-05");
    // The credential path is untouched by the overlay.
    expect(headers["x-api-key"]).toBe("sk-test");
  });

  it("keeps the fabricated UA on cold start (no authentic client seen)", async () => {
    vi.resetModules();
    await import("open-sse/utils/claudeHeaderCache.js"); // fresh, empty cache
    const mod = await import("open-sse/executors/default.js");
    const DefaultExecutor = mod.DefaultExecutor || mod.default;

    const headers = new DefaultExecutor("claude").buildHeaders({ apiKey: "sk-test" }, true);
    expect(headers["User-Agent"]).toMatch(/^claude-cli\//);
    expect(headers["user-agent"]).toBeUndefined();
  });

  it("does not overlay onto other providers", async () => {
    vi.resetModules();
    const cache = await import("open-sse/utils/claudeHeaderCache.js");
    cache.cacheClaudeHeaders({ "user-agent": "claude-code/2.1.63" });
    const mod = await import("open-sse/executors/default.js");
    const DefaultExecutor = mod.DefaultExecutor || mod.default;

    const headers = new DefaultExecutor("openai").buildHeaders({ apiKey: "sk-test" }, true);
    expect(headers["user-agent"]).toBeUndefined();
    expect(headers["User-Agent"]).toBeUndefined();
  });
});
