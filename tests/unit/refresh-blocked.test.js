/**
 * W5 · Token lifecycle — the refreshBlocked marker (MIBP fix 10).
 *
 * Plan: plans/2026-09-20-sibling-harbor-ports.md §3.2 rows 10-12 (v0.9.78).
 * A dead OAuth refresh token used to be retried on every sweeper tick, forever,
 * because Vela's sweeper swallowed every failure. The fix persists a marker —
 * but ONLY for a HARD auth failure (invalid_grant, or 400/401/403 returned by
 * the token endpoint). A transient failure (network error, timeout, 5xx) must
 * set nothing, or a blip becomes a permanent lockout. A later success lifts it.
 *
 * These tests boot the REAL DB into a temp DATA_DIR (never the operator's), so
 * the marker's persistence and lifting are proven at the seam, not mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isolateDataDir } from "../setup/isolateDataDir.js";

let iso;
let seq = 0;
const past = () => new Date(Date.now() - 60 * 1000).toISOString();
const nextToken = (tag) => `RT-${tag}-${++seq}`;

beforeEach(() => {
  iso = isolateDataDir("vela-w5-marker-");
});

afterEach(() => {
  vi.unstubAllGlobals();
  iso?.dispose();
  iso = null;
});

/** A token-endpoint response stub. `body` is returned by res.text()/res.json(). */
function stubTokenEndpoint({ ok, status, body }) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  })));
}

async function seedConnection(overrides = {}) {
  const { createProviderConnection, getProviderConnectionById } = await import("@/lib/db/index.js");
  const created = await createProviderConnection({
    provider: "grok-cli",
    authType: "oauth",
    refreshToken: overrides.refreshToken || nextToken("seed"),
    accessToken: "old-access",
    expiresAt: past(),
    isActive: true,
    providerSpecificData: overrides.providerSpecificData,
  });
  return getProviderConnectionById(created.id);
}

describe("refreshBlocked classification (pure)", () => {
  it("classifies invalid_grant and token-endpoint 400/401/403 as hard auth failures", async () => {
    const { isHardAuthRefreshFailure } = await import("../../src/sse/services/tokenRefresh.js");
    expect(isHardAuthRefreshFailure({ error: "invalid_grant" })).toBe(true);
    expect(isHardAuthRefreshFailure({ error: "unrecoverable_refresh_error" })).toBe(true);
    expect(isHardAuthRefreshFailure({ error: "refresh_token_reused" })).toBe(true);
    expect(isHardAuthRefreshFailure({ status: 400 })).toBe(true);
    expect(isHardAuthRefreshFailure({ status: 401 })).toBe(true);
    expect(isHardAuthRefreshFailure({ status: 403 })).toBe(true);
  });

  it("does NOT classify transient failures as hard auth failures", async () => {
    const { isHardAuthRefreshFailure } = await import("../../src/sse/services/tokenRefresh.js");
    expect(isHardAuthRefreshFailure(null)).toBe(false);
    expect(isHardAuthRefreshFailure(undefined)).toBe(false);
    expect(isHardAuthRefreshFailure({ status: 500 })).toBe(false);
    expect(isHardAuthRefreshFailure({ status: 502 })).toBe(false);
    expect(isHardAuthRefreshFailure({ status: 429 })).toBe(false);
    expect(isHardAuthRefreshFailure({ error: "network_error" })).toBe(false);
    // a successful refresh is obviously not a failure
    expect(isHardAuthRefreshFailure({ accessToken: "at" })).toBe(false);
  });
});

describe("(a) a TRANSIENT failure does NOT set the marker", () => {
  it("a network error leaves providerSpecificData untouched", async () => {
    const conn = await seedConnection({ refreshToken: nextToken("net") });
    // Every fetch (discovery + token) throws — a network blip, not an auth verdict.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const { getProviderConnectionById } = await import("@/lib/db/index.js");
    await runBackgroundTokenRefreshTick({ loadConnections: async () => [conn] });

    const row = await getProviderConnectionById(conn.id);
    expect(row.providerSpecificData?.refreshBlocked).toBeUndefined();
    expect(row.providerSpecificData?.refreshBlockedAt).toBeUndefined();
    // The credential was left alone — it is still retryable next tick.
    expect(row.accessToken).toBe("old-access");
  });

  it("a 5xx from the token endpoint sets nothing", async () => {
    const conn = await seedConnection({ refreshToken: nextToken("5xx") });
    stubTokenEndpoint({ ok: false, status: 503, body: { error: "server_error" } });

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const { getProviderConnectionById } = await import("@/lib/db/index.js");
    await runBackgroundTokenRefreshTick({ loadConnections: async () => [conn] });

    const row = await getProviderConnectionById(conn.id);
    expect(row.providerSpecificData?.refreshBlocked).toBeUndefined();
  });
});

describe("(b) an invalid_grant DOES set the marker", () => {
  it("persists refreshBlocked + refreshBlockedAt into providerSpecificData", async () => {
    const conn = await seedConnection({
      refreshToken: nextToken("grant"),
      providerSpecificData: { username: "keep-me" },
    });
    stubTokenEndpoint({
      ok: false,
      status: 400,
      body: { error: "invalid_grant", error_description: "Refresh token has been revoked" },
    });

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const { getProviderConnectionById } = await import("@/lib/db/index.js");
    await runBackgroundTokenRefreshTick({ loadConnections: async () => [conn] });

    const row = await getProviderConnectionById(conn.id);
    expect(row.providerSpecificData.refreshBlocked).toBe("invalid_grant");
    expect(typeof row.providerSpecificData.refreshBlockedAt).toBe("string");
    expect(Number.isFinite(Date.parse(row.providerSpecificData.refreshBlockedAt))).toBe(true);
    // The rest of the JSON column is preserved, not clobbered.
    expect(row.providerSpecificData.username).toBe("keep-me");
  });

  it("checkAndRefreshToken tags the result with refreshError for the scheduler", async () => {
    const conn = await seedConnection({ refreshToken: nextToken("tag") });
    stubTokenEndpoint({
      ok: false,
      status: 401,
      body: { error: "invalid_grant" },
    });
    const { checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");
    const result = await checkAndRefreshToken("grok-cli", conn, { force: true });
    expect(result.refreshError).toBeTruthy();
    expect(typeof result.refreshErrorAt).toBe("string");
    expect(result.refreshError).toBe("invalid_grant");
  });
});

describe("(c) a later success LIFTS the marker", () => {
  it("a successful refresh clears refreshBlocked + refreshBlockedAt", async () => {
    const conn = await seedConnection({
      refreshToken: nextToken("lift"),
      providerSpecificData: {
        refreshBlocked: "invalid_grant",
        refreshBlockedAt: new Date().toISOString(),
        username: "keep-me",
      },
    });
    stubTokenEndpoint({
      ok: true,
      status: 200,
      body: { access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3600 },
    });

    // The sweeper deliberately skips a marked row, so the lift arrives through
    // the request / re-auth path — the same checkAndRefreshToken call.
    const { checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");
    const { getProviderConnectionById } = await import("@/lib/db/index.js");
    await checkAndRefreshToken("grok-cli", conn, { force: true });

    const row = await getProviderConnectionById(conn.id);
    expect(row.providerSpecificData?.refreshBlocked).toBeUndefined();
    expect(row.providerSpecificData?.refreshBlockedAt).toBeUndefined();
    expect(row.providerSpecificData.username).toBe("keep-me");
    expect(row.accessToken).toBe("fresh-access");
  });

  it("the in-memory credentials returned by checkAndRefreshToken are unmarked too", async () => {
    const conn = await seedConnection({
      refreshToken: nextToken("lift2"),
      providerSpecificData: { refreshBlocked: "invalid_grant", refreshBlockedAt: "2026-01-01T00:00:00.000Z" },
    });
    stubTokenEndpoint({
      ok: true,
      status: 200,
      body: { access_token: "fresh-access-2", expires_in: 3600 },
    });
    const { checkAndRefreshToken, isRefreshBlocked } = await import(
      "../../src/sse/services/tokenRefresh.js"
    );
    const out = await checkAndRefreshToken("grok-cli", conn, { force: true });
    expect(isRefreshBlocked(out)).toBe(false);
    expect(out.providerSpecificData?.refreshBlocked).toBeUndefined();
  });
});

describe("(d) a marked connection is SKIPPED by the sweeper", () => {
  it("selectConnectionsNeedingRefresh never returns a marked connection", async () => {
    const { selectConnectionsNeedingRefresh } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const marked = {
      id: "blocked",
      provider: "grok-cli",
      authType: "oauth",
      refreshToken: "rt",
      expiresAt: past(),
      providerSpecificData: { refreshBlocked: "invalid_grant", refreshBlockedAt: "x" },
    };
    expect(selectConnectionsNeedingRefresh([marked])).toHaveLength(0);
    // Sanity: without the marker the same row IS due.
    expect(
      selectConnectionsNeedingRefresh([{ ...marked, providerSpecificData: {} }])
    ).toHaveLength(1);
  });

  it("the tick refreshes the unmarked connection and leaves the marked one alone", async () => {
    const marked = await seedConnection({
      refreshToken: nextToken("blocked"),
      providerSpecificData: { refreshBlocked: "invalid_grant", refreshBlockedAt: "2026-01-01T00:00:00.000Z" },
    });
    const live = await seedConnection({ refreshToken: nextToken("live") });

    const { runBackgroundTokenRefreshTick } = await import(
      "../../src/sse/services/backgroundTokenRefresh.js"
    );
    const { getProviderConnections, getProviderConnectionById } = await import("@/lib/db/index.js");

    const refreshConnection = vi.fn(async () => ({}));
    await runBackgroundTokenRefreshTick({
      loadConnections: () => getProviderConnections({ isActive: true }),
      refreshConnection,
    });

    // Only the live connection was offered to the refresher.
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(refreshConnection.mock.calls[0][0].id).toBe(live.id);

    // The marked row keeps its marker (nothing re-attempted it).
    const stillBlocked = await getProviderConnectionById(marked.id);
    expect(stillBlocked.providerSpecificData.refreshBlocked).toBe("invalid_grant");
  });
});
