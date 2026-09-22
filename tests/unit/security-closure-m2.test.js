import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Security Closure M2 — the three laws this tide added, each pinned against its own
 * module rather than a description of it:
 *
 *   1. The probe's URL gate (`proxyTest.js`). `testProxyUrl` / `testRelayUrl` dial a
 *      URL built from a request body, so both inputs cross the pool/provider gates.
 *      The load-bearing property is NOT "it refuses" — it is that a refusal returns
 *      422, never 400: 400 sits in DETERMINISTIC_FAILURE_STATUSES, so a 400 refusal
 *      would classify as DEAD and hand the health sweep a reason to disable the very
 *      pool whose config was refused (the v0.9.42 self-liquidation class).
 *
 *   2. The local-only wall as a CLASS (`dashboardGuard.js`). Thirteen
 *      `/api/cli-tools/<tool>-settings` routes write files in the operator's home
 *      directory; only `cowork-settings` was ever named. The wall now matches the
 *      shape, and this asserts the class positively AND asserts the reads it must not
 *      swallow.
 *
 *   3. The settings write surface (`/api/settings` PATCH). Every declared key is
 *      accepted; an undeclared one is dropped. The second half of that test is what
 *      keeps the first half honest — a roster that refuses everything would pass a
 *      "drops the plant" assertion while breaking the whole dashboard.
 *
 * The probe cases deliberately use a CLOSED local port (127.0.0.1:1) for the positive
 * control, the technique `proxy-storm-socks5-construction.test.js` established: a
 * connection to port 1 refuses immediately — no egress, no DNS, no third-party call.
 */

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: vi.fn(),
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
}));

const { testProxyUrl, testRelayUrl, classifyProbeVerdict } = await import(
  "@/lib/network/proxyTest.js"
);
const { __test__ } = await import("../../src/dashboardGuard.js");
const { WRITABLE_SETTING_KEYS } = await import("@/lib/db/repos/settingsDefaults.js");
const { PATCH } = await import("@/app/api/settings/route.js");

const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

describe("M2.1 — the probe refuses what the pool gate refuses, and a refusal is never death", () => {
  it("refuses a metadata PROXY with 422 — the verdict is indeterminate, not dead", async () => {
    const result = await testProxyUrl({
      proxyUrl: "http://169.254.169.254:80",
      testUrl: "https://example.invalid/probe",
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    // The load-bearing pair: 422 keeps it out of DETERMINISTIC_FAILURE_STATUSES.
    expect(result.status).toBe(422);
    expect(result.error).toContain("proxyUrl rejected");
    expect(classifyProbeVerdict(result)).toBe("indeterminate");
  });

  it("refuses the metadata ENDPOINT as the probe TARGET (the raw testUrl)", async () => {
    const result = await testProxyUrl({
      proxyUrl: "http://127.0.0.1:1",
      testUrl: METADATA_URL,
      timeoutMs: 1000,
    });

    expect(result.status).toBe(422);
    expect(result.error).toContain("testUrl rejected");
    expect(classifyProbeVerdict(result)).toBe("indeterminate");
  });

  it("refuses a non-network scheme instead of handing it to a dispatcher", async () => {
    const result = await testProxyUrl({ proxyUrl: "file:///etc/passwd", timeoutMs: 1000 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(classifyProbeVerdict(result)).toBe("indeterminate");
  });

  it("refuses a metadata relayUrl through the relay envelope path", async () => {
    const result = await testRelayUrl({ relayUrl: "http://169.254.169.254/", timeoutMs: 1000 });

    expect(result.status).toBe(422);
    expect(result.error).toContain("relayUrl rejected");
    expect(classifyProbeVerdict(result)).toBe("indeterminate");
  });

  it("PASSES a literal-loopback proxy (no 422) and still reads indeterminate on a dead port", async () => {
    // The positive control. A closed local port refuses at connect: no egress, no
    // third-party call — the same fixture the socks5 suite uses. What this proves is
    // that the gate did NOT refuse a legitimately-local proxy, and that a genuine
    // connection failure still never maps to "dead".
    const result = await testProxyUrl({ proxyUrl: "http://127.0.0.1:1", timeoutMs: 1500 });

    expect(result.status).not.toBe(422);
    expect(result.ok).toBe(false);
    expect(classifyProbeVerdict(result)).toBe("indeterminate");
  });
});

describe("M2.2 — the local-only wall matches the writer CLASS, not a list of names", () => {
  it("holds every <tool>-settings writer behind the local gate", () => {
    const writers = [
      "claude",
      "codex",
      "cline",
      "copilot",
      "deepseek-tui",
      "devin",
      "droid",
      "grok-build",
      "hermes",
      "jcode",
      "kilo",
      "openclaw",
      "opencode",
      "cowork",
    ];

    for (const tool of writers) {
      expect(__test__.isLocalOnlyRoute(`/api/cli-tools/${tool}-settings`)).toBe(true);
    }
  });

  it("covers the pxpipe lifecycle and the headroom pair that was missed", () => {
    for (const path of [
      "/api/pxpipe/install",
      "/api/pxpipe/start",
      "/api/pxpipe/stop",
      "/api/pxpipe/restart",
      "/api/headroom/restart",
      "/api/headroom/extras",
    ]) {
      expect(__test__.isLocalOnlyRoute(path)).toBe(true);
    }
  });

  it("does NOT swallow the read routes that share those prefixes", () => {
    for (const path of [
      "/api/cli-tools/all-statuses",
      "/api/cli-tools/cowork-mcp-tools",
      "/api/cli-tools/cowork-mcp-registry",
      "/api/pxpipe/status",
      "/api/pxpipe/health",
      "/api/pxpipe/stats",
      "/api/headroom/status",
    ]) {
      expect(__test__.isLocalOnlyRoute(path)).toBe(false);
    }
  });
});

describe("M2.3 — PATCH /api/settings writes only what it declares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.updateSettings.mockImplementation(async (body) => body);
  });

  const patchRequest = (body) => ({ json: async () => body });

  it("drops an undeclared key and keeps a declared one in the same body", async () => {
    const res = await PATCH(patchRequest({ requireLogin: false, plantedKey: "attacker" }));

    expect(res.status).toBe(200);
    const written = mocks.updateSettings.mock.calls[0][0];
    expect(written).not.toHaveProperty("plantedKey");
    expect(written.requireLogin).toBe(false);
  });

  it("accepts every key the dashboard genuinely persists", async () => {
    // These nine carry no default in DEFAULT_SETTINGS, so they are the keys most
    // likely to be silently lost by a roster that only derived from the defaults.
    const dashboardKeys = {
      ccFilterNaming: true,
      providerThinking: { claude: { mode: "auto" } },
      poolGeoProbeEnabled: false,
      fallbackStrategy: "fill-first",
      userInjectors: [],
      claudeAutoPing: {},
      codexAutoPing: {},
      headroomCodeAware: true,
      headroomKompress: false,
    };

    const res = await PATCH(patchRequest(dashboardKeys));

    expect(res.status).toBe(200);
    const written = mocks.updateSettings.mock.calls[0][0];
    expect(Object.keys(written).sort()).toEqual(Object.keys(dashboardKeys).sort());
  });

  it("still allows the two secrets it strips and re-shapes internally", async () => {
    // `password` is stripped by PROTECTED_SETTING_KEYS and re-set by the newPassword
    // branch, so it must survive the allow-list; `mitmSudoEncrypted` must not.
    const res = await PATCH(
      patchRequest({ mitmSudoEncrypted: "leak", currentPassword: "x" })
    );

    expect(res.status).toBe(200);
    const written = mocks.updateSettings.mock.calls[0][0];
    expect(written).not.toHaveProperty("mitmSudoEncrypted");
    expect(WRITABLE_SETTING_KEYS).toContain("password");
  });
});
