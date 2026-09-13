/**
 * Wound-2 (ADR-004, v0.9.62 The Proven Wounds) — search failure must not
 * take chat offline.
 *
 * The wound, mechanical: src/sse/handlers/search.js called
 * markAccountUnavailable(connectionId, status, error, providerId) with NO
 * model argument → auth.js builds `modelLock___all`, which isModelLockActive
 * treats as blocking EVERY model on the connection. On the credentialFallback
 * lane (a search provider borrowing a chat provider's key, W4 port), one
 * failing search therefore locked the shared chat key out of chat. And the
 * attribution used the SEARCH provider id while the connection belongs to the
 * CHAT provider — markAccountUnavailable's own row lookup then queried the
 * wrong provider.
 *
 * The fix (upstream ec669280 rebase + Vela exceed): scope the lock key to
 * `websearch:<provider>` through the whole round-trip — write (mark), read
 * (getProviderCredentials), clear (clearAccountError) — attribute the lock to
 * the provider that OWNS the connection (credentialProviderId), and harden
 * clearAccountError's scoped clears with compare-and-delete (S8): a lock whose
 * failure timestamp (lastErrorAt) is NEWER than the succeeding request's start
 * was written by a concurrent failure — a success older than a lock may not
 * forgive it. Unscoped clears are unchanged; the guard covers ONLY the
 * websearch: lane (chat passes no model and must keep its forgiving
 * semantics, and its suites must stay green).
 *
 * Real machinery, fake store: auth.js / accountFallback.js / search.js run
 * unmocked; the DB layer, keyGate, search core and heavy siblings are mocked
 * (mock shape per tests/unit/freebuff-lockout.test.js; call-arg assertions per
 * gemini-native-endpoint.test.js). RED until the fix lands — every assertion
 * is the patched shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  ...dbMocks,
  getSettings: vi.fn(async () => ({})),
  getCombos: vi.fn(async () => []),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  FREE_TIER_PROVIDERS: {},
  resolveProviderId: (p) => p,
  AI_PROVIDERS: {
    // A search provider that borrows `glm`'s chat credentials — the exact
    // shape that makes the unscoped lock a chat killer.
    xsearch: {
      name: "XSearch",
      searchConfig: { url: "https://x.invalid/search" },
      credentialFallback: "glm",
    },
    glm: { name: "GLM", searchConfig: { url: "https://g.invalid/search" } },
  },
}));

vi.mock("@/sse/services/keyGate.js", () => ({
  authorizeApiRequest: vi.fn(async () => ({ ok: true })),
}));

const coreMocks = vi.hoisted(() => ({ handleSearchCore: vi.fn() }));
vi.mock("open-sse/handlers/search/index.js", () => coreMocks);

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
}));

vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  getComboModelsFromData: vi.fn(async () => null),
}));

vi.mock("@/lib/db/repos/bindFallbackRules.js", () => ({
  getFallbackRulesRepo: vi.fn(async () => ({})),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), request: vi.fn(),
}));

const { handleSearch } = await import("../../src/sse/handlers/search.js");
const { clearAccountError } = await import("../../src/sse/services/auth.js");

function searchRequest(provider) {
  return new Request("https://vela.invalid/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, query: "tidal currents" }),
  });
}

// A raw glm-owned connection row, exactly as the authed lane returns it.
function glmConnection(overrides = {}) {
  return {
    id: "c-glm",
    connectionId: "c-glm",
    provider: "glm",
    name: "glm-main",
    testStatus: "active",
    backoffLevel: 0,
    lastError: null,
    lastErrorCode: null,
    lastErrorAt: null,
    providerSpecificData: { apiKey: "k" },
    ...overrides,
  };
}

function mockGlmRows(rows) {
  dbMocks.getProviderConnections.mockImplementation(async ({ provider }) =>
    provider === "glm" ? rows : []);
}

function failedCore(status = 429, error = "Too Many Requests") {
  coreMocks.handleSearchCore.mockResolvedValue({ success: false, status, error });
}

function succeedingCore() {
  coreMocks.handleSearchCore.mockImplementation(async (opts) => {
    await opts.onRequestSuccess?.();
    return { success: true, response: new Response("{}", { status: 200 }) };
  });
}

// Patches written by updateProviderConnection that touch any modelLock_ key.
function lockPatches() {
  return dbMocks.updateProviderConnection.mock.calls
    .map(([, p]) => p)
    .filter((p) => p && Object.keys(p).some((k) => k.startsWith("modelLock_")));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGlmRows([glmConnection()]); // xsearch: no own rows; glm owns c-glm
  dbMocks.updateProviderConnection.mockResolvedValue(undefined);
});

describe("search failure locks are scoped and attributed (wound-2)", () => {
  it("a failing search writes a scoped websearch lock, NOT the account-wide lock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T12:00:00.000Z"));
    try {
      failedCore();
      await handleSearch(searchRequest("xsearch"));

      const patches = lockPatches();
      expect(patches.length, "failure should write a lock").toBeGreaterThanOrEqual(1);
      for (const p of patches) {
        // The wound: modelLock___all blocks chat too. Post-fix it is simply
        // never the shape a search failure produces.
        expect(p, "search failure must not write modelLock___all").not.toHaveProperty("modelLock___all");
        expect(p).toHaveProperty("modelLock_websearch:xsearch");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("attributes the lock to the connection-OwNING provider (glm), not the search id", async () => {
    failedCore();
    await handleSearch(searchRequest("xsearch"));

    // markAccountUnavailable looks the row up by its provider arg. Pre-fix it
    // queries {provider:"xsearch"} only (wrong lane → stale backoffLevel read,
    // conn=undefined). Post-fix: the owning provider gets queried.
    const owningLookup = dbMocks.getProviderConnections.mock.calls
      .some(([args]) => args?.provider === "glm" && !("isActive" in args));
    expect(owningLookup, "lock attribution must follow the owning provider").toBe(true);
  });

  it("a live websearch lock blocks SEARCH selection (round-trip) — the fix's read side", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    mockGlmRows([glmConnection({ "modelLock_websearch:xsearch": future })]);

    const res = await handleSearch(searchRequest("xsearch"));
    // The scoped key must reach getProviderCredentials, or the lock is written
    // and never honored: selection would find the row available and call the
    // core. Post-fix: locked out, 503, core untouched.
    expect(coreMocks.handleSearchCore, "locked lane must not be attempted").not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });
});

describe("search success clears its scoped lock, compare-and-delete (S8)", () => {
  it("contract (green before AND after): an expired scoped lock is swept by a successful search", async () => {
    // Reachable clear-path through the handler: an EXPIRED lock passes
    // selection, the success sweeps it. Guard law — the S8 start-argument
    // must never break expired cleanup. (The predating-live-lock case is
    // architecturally unreachable via selection: a live scoped lock blocks
    // the attempt outright — covered by the round-trip test above, and the
    // fresh-write race is covered at the seam below.)
    const expired = new Date(Date.now() - 1000).toISOString();
    mockGlmRows([glmConnection({ "modelLock_websearch:xsearch": expired, lastErrorAt: expired, lastError: "old", lastErrorCode: 429 })]);
    succeedingCore();
    const res = await handleSearch(searchRequest("xsearch"));
    expect(res.status).toBe(200);
    const clears = lockPatches().filter(p => "modelLock_websearch:xsearch" in p);
    expect(clears.length, "expired scoped lock must be nulled").toBeGreaterThanOrEqual(1);
    expect(clears.at(-1)["modelLock_websearch:xsearch"]).toBeNull();
  });

  it("leaves a scoped lock alone when a NEWER concurrent failure wrote it (race)", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    // No lock at selection; fresh failure (timestamp in the near future =
    // strictly later than this request's start) during the success clear.
    mockGlmRows([glmConnection()]);
    succeedingCore();
    await handleSearch(searchRequest("xsearch")); // succeeds, clears nothing (no locks)

    const freshRow = glmConnection({
      "modelLock_websearch:xsearch": future,
      lastError: "concurrent failure",
      lastErrorAt: new Date(Date.now() + 30_000).toISOString(), // AFTER request start
    });
    dbMocks.updateProviderConnection.mockClear();
    await clearAccountError("c-glm", freshRow, "websearch:xsearch", Date.now());

    const scopedNulls = lockPatches().filter(
      (p) => "modelLock_websearch:xsearch" in p && p["modelLock_websearch:xsearch"] === null,
    );
    expect(scopedNulls, "a success older than the failure must NOT forgive it").toHaveLength(0);
    void freshRow;
  });
});

describe("guard law: unscoped clears are untouched (chat semantics preserved)", () => {
  it("clearAccountError without a model still clears an expired __all lock", async () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    const row = glmConnection({
      modelLock___all: expired,
      testStatus: "unavailable",
      lastError: "old chat failure",
      lastErrorAt: expired,
    });
    dbMocks.updateProviderConnection.mockClear();
    await clearAccountError("c-glm", row); // no model arg — chat lane, old behavior
    const cleared = lockPatches().some(p => p.modelLock___all === null);
    expect(cleared, "expired account lock still lazy-cleans on unscoped clear").toBe(true);
  });
});
