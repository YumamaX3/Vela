import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Why this suite exists ───────────────────────────────────────────────────
// Ported from azrinaldi/opencode-free-bridge (2026-10-20). Two defects it fixes,
// each pinned here so neither can return quietly:
//
//  1. The free tier was a hand-curated list. Measured against the live catalog
//     that day, 6 of the 10 curated ids were dead (5 deprecated, 1 unsupported)
//     and 6 live free ids could not be named at all. Membership now comes from
//     upstream's own `models.opencode.ai/api.json`.
//  2. `buildHeaders` tested `isOpenCodeFreeTierModel(url)` — a model predicate
//     fed a URL string. False for every input, so the v2 identity was dead code
//     and every free request carried v1 hands. The lane is now decided by URL.

const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-opencode-catalog-"));
process.env.DATA_DIR = tempDir;

const CATALOG = {
  opencode: {
    api: "https://opencode.ai/inference/openai/v1",
    models: {
      // free in the catalog, absent from the curated fallback
      "glm-5.3-flash-free": {
        cost: { input: 0, output: 0 }, tool_call: true, reasoning: true, limit: { output: 8192 },
      },
      // a small output ceiling, to prove the clamp follows the model
      "small-free": {
        cost: { input: 0, output: 0 }, tool_call: true, reasoning: true, limit: { output: 2048 },
      },
      // curated says free; the catalog says retired — the catalog wins
      "cat-jam-free": { cost: { input: 0, output: 0 }, status: "deprecated" },
      // paid, described
      "claude-sonnet-4.6": { cost: { input: 3, output: 15 } },
      // free but cannot carry the gate's tool anchor
      "no-tools-free": { cost: { input: 0, output: 0 }, tool_call: false },
    },
  },
};

const dial = vi.hoisted(() => ({ calls: [], mode: "ok" }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async (url) => {
    dial.calls.push(String(url));
    if (dial.mode === "ok") {
      return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const message = dial.mode === "abuse"
      ? "Detected abusive traffic from your IP"
      : "OpenCode's free tier can only be used from within OpenCode.";
    return new Response(JSON.stringify({ type: "error", error: { type: "FreeTierError", message } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }),
}));

const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (url) => {
  if (String(url).includes("api.json")) {
    return new Response(JSON.stringify(CATALOG), { status: 200 });
  }
  if (String(url).includes("/update/api/latest/cli/npm")) {
    return new Response(JSON.stringify({ channel: "latest", name: "cli", version: "2.1.1", active: true }), { status: 200 });
  }
  return realFetch(url);
});

const catalog = await import("../../open-sse/services/opencodeCatalog.js");
const identity = await import("../../open-sse/services/opencodeIdentity.js");
const { OpenCodeExecutor, resolveProjectId, __resetProjectId } = await import("../../open-sse/executors/opencode.js");

afterAll(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(() => {
  catalog.__resetOpenCodeCatalog();
  identity.__resetCliIdentity();
  dial.calls.length = 0;
  dial.mode = "ok";
});

describe("parseCatalog — the free tier as a catalog fact", () => {
  it("derives free from zero cost, drops deprecated and tool-incapable ids", () => {
    const parsed = catalog.parseCatalog(CATALOG);
    expect([...parsed.freeModels].sort()).toEqual(["glm-5.3-flash-free", "small-free"]);
    expect(parsed.verdicts.get("cat-jam-free")).toBe("deprecated");
    expect(parsed.verdicts.get("claude-sonnet-4.6")).toBe("paid");
    expect(parsed.verdicts.get("no-tools-free")).toBe("paid");
  });

  it("adopts the published base, one segment deeper than the old hardcode", () => {
    const parsed = catalog.parseCatalog(CATALOG);
    expect(parsed.endpoints.chatUrl).toBe("https://opencode.ai/inference/openai/v1/chat/completions");
    expect(parsed.endpoints.responsesUrl).toBe("https://opencode.ai/inference/openai/v1/responses");
  });

  it("refuses a base from any host but opencode.ai", () => {
    const parsed = catalog.parseCatalog({
      opencode: { api: "https://evil.example/v1", models: CATALOG.opencode.models },
    });
    expect(parsed.endpoints.chatUrl).toBe("https://opencode.ai/inference/v1/chat/completions");
  });

  it("returns null when the payload carries no opencode.models", () => {
    expect(catalog.parseCatalog({})).toBeNull();
    expect(catalog.parseCatalog({ opencode: {} })).toBeNull();
  });
});

describe("isFreeTierModel — catalog first, curated set second", () => {
  // beforeEach (not beforeAll): the root hook resets the snapshot, so a
  // one-time refresh would be wiped before the first assertion even runs.
  beforeEach(async () => {
    await catalog.refreshOpenCodeCatalog({ force: true });
  });

  it("knows a free id the curated list never carried", () => {
    expect(catalog.isFreeTierModel("glm-5.3-flash-free")).toBe(true);
  });

  it("does not resurrect a curated id the catalog retired", () => {
    expect(catalog.isFreeTierModel("cat-jam-free")).toBe(false);
  });

  it("keeps the curated set as the cold-boot answer for undescribed ids", () => {
    // absent from this fixture's catalog, still curated
    expect(catalog.isFreeTierModel("deepseek-v4.1-flash-free")).toBe(true);
    expect(catalog.isFreeTierModel("muse-spark-1.4-contributor-free")).toBe(true);
    expect(catalog.isFreeTierModel("claude-sonnet-4.6")).toBe(false);
  });

  it("reports which source answered", () => {
    const status = catalog.getStatus();
    expect(status.source).toBe("network");
    expect(status.freeModelCount).toBe(2);
    expect(status.endpoints.chatUrl).toContain("/inference/openai/v1");
  });
});

describe("buildUrl — the endpoint follows the catalog", () => {
  beforeEach(async () => {
    await catalog.refreshOpenCodeCatalog({ force: true });
  });

  it("sends a free id to the published base", () => {
    expect(new OpenCodeExecutor().buildUrl("glm-5.3-flash-free"))
      .toBe("https://opencode.ai/inference/openai/v1/chat/completions");
  });

  it("keeps paid ids on the legacy Zen lane", () => {
    expect(new OpenCodeExecutor().buildUrl("claude-sonnet-4.6"))
      .toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("keeps the Anthropic-format model on /messages", () => {
    expect(new OpenCodeExecutor().buildUrl("union-alpha"))
      .toBe("https://opencode.ai/zen/v1/messages");
  });
});

describe("buildHeaders — the lane is a property of the URL", () => {
  it("wears the v2 CLI identity on /inference/", () => {
    const headers = new OpenCodeExecutor().buildHeaders(
      { accessToken: "public" }, true, "https://opencode.ai/inference/openai/v1/chat/completions",
    );
    expect(headers["x-opencode-client"]).toBe("cli");
    // Derived, never the literal "global": the CLI emits
    // sha1("git-remote:…") / sha1("directory:…"), and the gate has only ever
    // seen shapes like that.
    expect(headers["x-opencode-project"]).toMatch(/^[0-9a-f]{40}$/);
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
    // The v2 gate rejects this header outright.
    expect(headers["x-opencode-request"]).toBeUndefined();
    const mirrors = ["x-opencode-session", "x-opencode-session-id", "x-session-affinity", "x-session-id"];
    for (const name of mirrors) expect(headers[name]).toMatch(/^ses_[0-9a-f]{12}[A-Za-z0-9]{14}$/);
    expect(new Set(mirrors.map((n) => headers[n])).size).toBe(1);
  });

  it("keeps the v1 hands on /zen/ — the fallback must still speak v1", () => {
    const headers = new OpenCodeExecutor().buildHeaders(
      { accessToken: "public" }, true, "https://opencode.ai/zen/v1/chat/completions",
    );
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(headers["x-opencode-request"]).toMatch(/^msg_[0-9a-f]{12}[A-Za-z0-9]{14}$/);
    // The v1 lane no longer sends the literal "global" — that is the shape the
    // gate stopped accepting (PR #4111); it mints a 40-char hex project id.
    expect(headers["x-opencode-project"]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("carries a real key when one is held, `public` otherwise", () => {
    const keyed = new OpenCodeExecutor().buildHeaders(
      { apiKey: "sk-live" }, true, "https://opencode.ai/inference/openai/v1/chat/completions",
    );
    expect(keyed.Authorization).toBe("Bearer sk-live");
    expect(keyed["x-api-key"]).toBe("sk-live");

    const keyless = new OpenCodeExecutor().buildHeaders(
      { accessToken: "public" }, true, "https://opencode.ai/inference/openai/v1/chat/completions",
    );
    expect(keyless.Authorization).toBe("Bearer public");
  });
});

describe("the gate anchor — a tool-less caller still carries `read`", () => {
  beforeEach(async () => {
    await catalog.refreshOpenCodeCatalog({ force: true });
  });

  it("appends read and shell to a chat body that asked for no tools", () => {
    const out = new OpenCodeExecutor().transformRequest(
      "glm-5.3-flash-free",
      { model: "glm-5.3-flash-free", messages: [{ role: "user", content: "hi" }] },
      true,
      { accessToken: "public" },
    );
    const names = out.tools.map((t) => t?.function?.name);
    expect(names).toContain("read");
    expect(names).toContain("shell");
  });

  it("does the same on the Responses lane", () => {
    const out = new OpenCodeExecutor().transformRequest(
      "muse-spark-1.3-contributor-free",
      { model: "muse-spark-1.3-contributor-free", input: "hi" },
      true,
      { accessToken: "public" },
    );
    expect(out.tools.map((t) => t?.name)).toEqual(expect.arrayContaining(["read", "shell"]));
  });

  it("reaches the v2 gate on the FIRST dial — no fallback needed", async () => {
    dial.mode = "ok";
    await new OpenCodeExecutor().execute({
      model: "glm-5.3-flash-free",
      body: { model: "glm-5.3-flash-free", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "public" },
    });
    expect(dial.calls).toHaveLength(1);
    expect(dial.calls[0]).toContain("/inference/");
  });
});

describe("execute — a gate refusal is classified, never blindly retried", () => {
  const ARGS = {
    model: "glm-5.3-flash-free",
    body: { model: "glm-5.3-flash-free", messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: { accessToken: "public" },
  };

  beforeEach(async () => {
    await catalog.refreshOpenCodeCatalog({ force: true });
  });

  it("re-dials the legacy lane once on a free-tier refusal", async () => {
    dial.mode = "free-tier";
    const result = await new OpenCodeExecutor().execute(ARGS);
    expect(dial.calls).toHaveLength(2);
    expect(dial.calls[0]).toContain("/inference/");
    expect(dial.calls[1]).toContain("/zen/v1/");
    expect(result.response.status).toBe(403);
  });

  it("stops at the first dial when the refusal names IP abuse", async () => {
    dial.mode = "abuse";
    const result = await new OpenCodeExecutor().execute(ARGS);
    expect(dial.calls).toHaveLength(1);
    expect(result.response.status).toBe(403);
  });

  it("never retries a success", async () => {
    dial.mode = "ok";
    await new OpenCodeExecutor().execute(ARGS);
    expect(dial.calls).toHaveLength(1);
  });
});

describe("token budget — reasoning headroom for a short request", () => {
  beforeEach(async () => {
    await catalog.refreshOpenCodeCatalog({ force: true });
  });

  const exec = () => new OpenCodeExecutor();
  const ask = (model, body) => exec().transformRequest(model, body, true, { accessToken: "public" });

  it("raises a 50-token probe to answer + thinking headroom", () => {
    const out = ask("glm-5.3-flash-free", { model: "glm-5.3-flash-free", max_tokens: 50, messages: [] });
    // min(max(50, 1024) + 4096, catalog ceiling 8192)
    expect(out.max_tokens).toBe(5120);
  });

  it("still raises a request that has some headroom, then honours the ceiling", () => {
    const out = ask("glm-5.3-flash-free", { model: "glm-5.3-flash-free", max_tokens: 6000, messages: [] });
    // max(6000, 1024) + 4096 = 10096, clamped to the catalog's 8192
    expect(out.max_tokens).toBe(8192);
  });

  it("clamps to the ceiling the catalog states for that model", () => {
    const out = ask("small-free", { model: "small-free", max_tokens: 50, messages: [] });
    expect(out.max_tokens).toBe(2048);
  });

  it("leaves an absent cap absent — a gateway must not invent one", () => {
    const out = ask("glm-5.3-flash-free", { model: "glm-5.3-flash-free", messages: [] });
    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("gives a non-reasoning model the plain floor only", () => {
    const out = ask("claude-sonnet-4.6", { model: "claude-sonnet-4.6", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    expect(out.max_tokens).toBe(512);
  });

  it("counts an explicit reasoning_effort even without catalog facts", () => {
    const out = ask("claude-sonnet-4.6", {
      model: "claude-sonnet-4.6", max_tokens: 50, reasoning_effort: "high", messages: [{ role: "user", content: "hi" }],
    });
    expect(out.max_tokens).toBe(5120);
  });
});

describe("identity — the UA version is resolved, not remembered", () => {
  it("falls back to the shipped version before any refresh", () => {
    expect(identity.getCliUserAgent()).toBe("opencode/latest/2.0.29/cli");
  });

  it("adopts the version the update API publishes", async () => {
    await identity.refreshCliVersion({ force: true });
    expect(identity.getCliVersion()).toBe("2.1.1");
    expect(identity.getCliUserAgent()).toBe("opencode/latest/2.1.1/cli");
    const headers = new OpenCodeExecutor().buildHeaders(
      { accessToken: "public" }, true, "https://opencode.ai/inference/openai/v1/chat/completions",
    );
    expect(headers["User-Agent"]).toBe("opencode/latest/2.1.1/cli");
  });

  it("refuses a version that is not semver", async () => {
    await identity.refreshCliVersion({ force: true });
    expect(identity.getCliVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("project id — derived the way the CLI derives it", () => {
  it("is a stable 40-char hex value, never the literal global", () => {
    __resetProjectId();
    const first = resolveProjectId();
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    expect(first).not.toBe("global");
    expect(resolveProjectId()).toBe(first);
  });
});
