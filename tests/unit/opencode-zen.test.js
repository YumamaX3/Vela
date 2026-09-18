/**
 * OpenCode Zen rebrand (v0.6.41) — registry invariants, executor hybrid auth
 * headers, and the hybrid freeTier noAuth lane in getProviderCredentials.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import opencode from "../../open-sse/providers/registry/opencode.js";
import {
  OpenCodeExecutor,
  OPENCODE_REQUEST_RE,
  OPENCODE_SESSION_RE,
} from "../../open-sse/executors/opencode.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

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

  it("keeps noAuth in the freeTier catalog — the keyless UI lanes read it", async () => {
    // The provider detail test button, the usage panel and the model selector
    // all gate their keyless affordances on this flag. Removing it silently
    // hides the keyless lane again (the v0.6.41 UI regression this pins).
    const { FREE_TIER_PROVIDERS } = await vi.importActual(
      "../../src/shared/constants/providers.js"
    );
    expect(FREE_TIER_PROVIDERS["opencode"]?.noAuth).toBe(true);
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
      // Zen's 2026-09-17 gate rejects a UUID-shaped id — canonical only.
      expect(h["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
      expect(h["x-opencode-session"]).toHaveLength(30);
      expect(h["x-opencode-request"]).toMatch(OPENCODE_REQUEST_RE);
      expect(h["x-opencode-request"]).toHaveLength(30);
      // Canonical 40-char hex (PR #4111) — the literal "global" is no longer a
      // shape the gate accepts.
      expect(h["x-opencode-project"]).toMatch(/^[0-9a-f]{40}$/);
      // The full client fingerprint, not the bare version (upstream #4105/#4111).
      expect(h["User-Agent"]).toBe(
        "opencode/1.18.31 ai-sdk/provider-utils/4.0.46 runtime/bun/1.3.14"
      );
      expect(h["Content-Type"]).toBe("application/json");
      expect(h.Accept).toBe("text/event-stream");
    }
    expect(headerFor({}, false).Accept).toBe("*/*");
  });
  it("sends x-api-key alongside Bearer on both lanes (#4111)", () => {
    expect(headerFor({ accessToken: "public" })["x-api-key"]).toBe("public");
    expect(headerFor({ apiKey: "zen-key-123" })["x-api-key"]).toBe("zen-key-123");
    expect(headerFor(null)["x-api-key"]).toBe("public");
  });
  it("passes a real client project id through but replaces the 'global' placeholder", () => {
    const real = "f".repeat(40);
    expect(headerFor({ rawHeaders: { "x-opencode-project": real } })["x-opencode-project"]).toBe(real);
    expect(headerFor({ rawHeaders: { "x-opencode-project": "global" } })["x-opencode-project"])
      .toMatch(/^[0-9a-f]{40}$/);
  });
});
describe("OpenCodeExecutor Responses lane", () => {
  const ex = new OpenCodeExecutor();
  it("routes muse-spark / grok-4.6 / gpt-5.6-luna to /responses", () => {
    for (const m of ["muse-spark-1.3-contributor", "muse-spark-1.2-contributor", "oc/muse-spark-1.3", "grok-4.6", "gpt-5.6-luna"]) {
      expect(ex.buildUrl(m)).toBe("https://opencode.ai/zen/v1/responses");
    }
  });
  it("keeps ordinary models on /chat/completions", () => {
    for (const m of ["big-pickle", "claude-opus-5", "grok-4.5"]) {
      expect(ex.buildUrl(m)).toBe("https://opencode.ai/zen/v1/chat/completions");
    }
  });
  it("conceals the capitalised file-search quartet by RENAMING, never duplicating", () => {
    const body = {
      model: "big-pickle",
      tools: [
        { type: "function", function: { name: "Bash", parameters: {} } },
        { type: "function", function: { name: "Grep", parameters: {} } },
        { type: "function", function: { name: "my_tool", parameters: {} } },
      ],
    };
    const { body: out, toolNameMap } = ex.concealFingerprintTools(body);
    const names = out.tools.map((t) => t.function.name);
    expect(names).toEqual(["bash", "grep", "my_tool"]);
    // No duplicate name may survive — a twin turns the 403 into a 500.
    expect(new Set(names).size).toBe(names.length);
    expect(toolNameMap.get("bash")).toBe("Bash");
    expect(toolNameMap.get("grep")).toBe("Grep");
    expect(toolNameMap.size).toBe(2);
  });
  it("handles the top-level name shape the Responses API uses", () => {
    const body = { tools: [{ type: "function", name: "Read", parameters: {} }] };
    const { body: out, toolNameMap } = ex.concealFingerprintTools(body);
    expect(out.tools[0].name).toBe("read");
    expect(toolNameMap.get("read")).toBe("Read");
  });
  it("leaves an already-lowercase quartet untouched and reports no map", () => {
    const body = { tools: [{ type: "function", function: { name: "bash", parameters: {} } }] };
    const { body: out, toolNameMap } = ex.concealFingerprintTools(body);
    expect(out).toBe(body);
    expect(toolNameMap).toBeNull();
  });
  it("restores the client's own spelling on an outgoing chunk", () => {
    const map = new Map([["bash", "Bash"]]);
    const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "bash", arguments: "{}" } }] } }] };
    const out = OpenCodeExecutor.restoreChunkToolNames(chunk, map);
    expect(out.choices[0].delta.tool_calls[0].function.name).toBe("Bash");
    // Untouched chunks come back as the same reference.
    expect(OpenCodeExecutor.restoreChunkToolNames(chunk, null)).toBe(chunk);
  });
});
describe("OpenCode muse-spark capabilities", () => {
  it("declares vision + reasoning + tools on the Zen free lane (plain and -free ids)", () => {
    for (const m of ["muse-spark-1.2", "muse-spark-1.3", "muse-spark-1.2-contributor-free", "muse-spark-1.3-contributor-free"]) {
      const caps = getCapabilitiesForModel("opencode", m);
      expect(caps).toMatchObject({ vision: true, reasoning: true, tools: true });
    }
  });
  it("declares the same on the paid OpenCode Go lane", () => {
    for (const m of ["muse-spark-1.2-contributor", "muse-spark-1.3-contributor"]) {
      expect(getCapabilitiesForModel("opencode-go", m)).toMatchObject({ vision: true, reasoning: true, tools: true });
    }
  });
  it("leaves Jerouter's text-only resale of the same ids untouched", () => {
    // Two lanes, two truths: Jerouter annotates muse-spark text-only, and the
    // capability must stay scoped to the opencode providers (pinned separately
    // by jerouter-catalog.test.js). A global pattern here would trample it.
    expect(getCapabilitiesForModel("jerouter", "muse-spark-1.3-contributor").vision).toBe(false);
    expect(getCapabilitiesForModel("je", "muse-spark-1.3-contributor").vision).toBe(false);
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
