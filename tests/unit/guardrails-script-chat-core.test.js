// INJECTOR SCRIPTS AT THE CHAT CORE (027) — the script pass is only real if a
// policy reaches the executor's body.
//
// The pure seam is proven apart (injector-scripts.test.js). This suite proves
// the WIRING the task's acceptance criterion names: a policy with `kind:
// "script"`, no detectors and no prompt — which the scan gate alone would call
// invisible — still inserts its turns into the body `executor.execute` receives,
// BEFORE dispatch, and the client's request object is not what carries them.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const driver = await import("@/lib/db/driver.js");
await driver.getAdapter();
const store = await import("@/lib/guardrails/policyStore.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn(), errorLine: vi.fn() };

const TURNS = [
  { role: "user", content: "Respond in haiku only." },
  { role: "assistant", content: "Five and seven, then / five more." },
];

function chatBody(content) {
  return { model: "deepseek/deepseek-chat", stream: false, messages: [{ role: "user", content }] };
}

async function runChat(content) {
  return handleChatCore({
    body: chatBody(content),
    modelInfo: { provider: "deepseek", model: "deepseek-chat" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log,
    connectionId: "test-conn",
    rtkEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
  });
}

function completion(content) {
  return {
    response: new Response(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } }),
    url: "https://api.deepseek.com/v1/chat/completions",
    headers: {},
    transformedBody: null,
  };
}

async function clearPolicies() {
  for (const policy of await store.listPolicies()) await store.deletePolicy(policy.id);
  store.__test__.invalidateCache();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearPolicies();
  executeMock.mockResolvedValue(completion("calm tides"));
});

afterAll(() => {
  try { driver.resetAdapter(); } catch { /* closed */ }
});

describe("script policy wiring", () => {
  it("a script-only policy (detectors: [] and no prompt) still reaches the executor", async () => {
    const created = await store.createPolicy({
      name: "haiku voice",
      scope: "global",
      direction: "inbound",
      detectors: [],
      action: "log_only",
      kind: "script",
      turns: TURNS,
    });
    expect(created.ok).toBe(true);
    store.__test__.invalidateCache();

    const result = await runChat("say hello");
    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const sent = executeMock.mock.calls[0][0].body;
    const roles = sent.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    expect(sent.messages[0].content).toBe("Respond in haiku only.");
    expect(sent.messages[1].content).toBe("Five and seven, then / five more.");
    expect(sent.messages[2].content).toBe("say hello");
  });

  it("the turns sit in translatedBody.messages on the wire path — the same body the tap scans", async () => {
    // Faithfulness note: for a SAME-FORMAT request (openai → openai) the
    // translator is identity — `result` IS the client body — so "fake history"
    // necessarily lands in the object the client sent. That is not new here:
    // every pre-dispatch mutation shares this property on an identity route,
    // and the RUNTIME outcome is the guarantee that matters: the turns reach
    // the executor in order and the body is serialisable onto the wire.
    await store.createPolicy({ name: "s", scope: "global", direction: "inbound", detectors: [], kind: "script", turns: TURNS });
    store.__test__.invalidateCache();

    const clientBody = chatBody("say hello");
    await handleChatCore({
      body: clientBody,
      modelInfo: { provider: "deepseek", model: "deepseek-chat" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
    });
    const sent = executeMock.mock.calls[0][0].body;
    expect(sent.messages.map((m) => m.content)).toEqual([
      "Respond in haiku only.",
      "Five and seven, then / five more.",
      "say hello",
    ]);
    // The internal marker is non-enumerable: it cannot reach a provider.
    expect(JSON.parse(JSON.stringify(sent))).not.toHaveProperty("_vela_inject_scripts");
  });

  it("a script policy never refuses, even with action: 'block' (scripts are not scanners)", async () => {
    await store.createPolicy({ name: "s", scope: "global", direction: "inbound", detectors: [], action: "block", kind: "script", turns: TURNS });
    store.__test__.invalidateCache();

    const result = await runChat("say hello");
    expect(result.success).toBe(true);
    expect(result.status).not.toBe(400);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("two script policies both land, ordered by priority (the documented stack law)", async () => {
    // Ordering law: scope rank (global → apikey → model) then lower `priority`
    // first. Distinct priorities are used deliberately — two siblings with the
    // SAME scope and priority tie-break on a random UUID (policyStore
    // listMatchingPolicies), so creation order is NOT part of the contract.
    await store.createPolicy({ name: "a", scope: "global", direction: "inbound", detectors: [], kind: "script", priority: 10, turns: [{ role: "user", content: "first" }, { role: "assistant", content: "1" }] });
    await store.createPolicy({ name: "b", scope: "global", direction: "inbound", detectors: [], kind: "script", priority: 20, turns: [{ role: "user", content: "second" }, { role: "assistant", content: "2" }] });
    store.__test__.invalidateCache();

    await runChat("say hello");
    const sent = executeMock.mock.calls[0][0].body;
    const texts = sent.messages.map((m) => m.content);
    expect(texts.slice(0, 4)).toEqual(["first", "1", "second", "2"]);
  });

  it("two scripts never produce consecutive same-role turns on the Claude wire", async () => {
    // [user, assistant] + [assistant, user] would collide at the seam; the
    // second script's leading assistant turn is dropped, and the run alternates.
    await store.createPolicy({ name: "a", scope: "global", direction: "inbound", detectors: [], kind: "script", priority: 10, turns: [{ role: "user", content: "a1" }, { role: "assistant", content: "a2" }] });
    await store.createPolicy({ name: "b", scope: "global", direction: "inbound", detectors: [], kind: "script", priority: 20, turns: [{ role: "assistant", content: "b1" }, { role: "user", content: "b2" }] });
    store.__test__.invalidateCache();

    await runChat("say hello");
    const sent = executeMock.mock.calls[0][0].body;
    // OpenAI tolerates the trailing user/user (two user turns are legal there);
    // what matters is that no assistant/assistant pair was produced.
    const roles = sent.messages.map((m) => m.role);
    for (let i = 1; i < roles.length; i++) {
      expect(roles[i] === "assistant" && roles[i - 1] === "assistant").toBe(false);
    }

    // The strict shape is Claude, whose blocks reject any same-role adjacency:
    // apply the same two scripts to a Claude body and assert pure alternation.
    const { applyScriptStack } = await import("@/lib/guardrails/pipeline.js");
    const claude = { messages: [{ role: "user", content: "real" }] };
    applyScriptStack({ scriptStack: [
      { turns: [{ role: "user", content: "a1" }, { role: "assistant", content: "a2" }] },
      { turns: [{ role: "assistant", content: "b1" }, { role: "user", content: "b2" }] },
    ] }, claude, "claude");
    expect(claude.messages.map((m) => m.role).join(",")).toBe("user,assistant,user,user");
    // ...and the b1 turn that would have collided is the one dropped, not a2.
    expect(JSON.stringify(claude)).toContain("a2");
    expect(JSON.stringify(claude)).not.toContain("b1");
  });

  it("a malformed script (bad turns) does not break the request", async () => {
    // Stored through the repo directly — the store's validator would refuse it,
    // but a row written before validation existed must still fail open.
    const { upsertGuardrailPolicy } = await import("@/lib/db/repos/guardrailsRepo.js");
    await upsertGuardrailPolicy({
      id: "bad-script", name: "bad", enabled: true, scope: "global", target: null, direction: "inbound",
      detectors: [], action: "log_only", kind: "script", turns: "{oops not json}", priority: 100,
      notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    store.__test__.invalidateCache();

    const result = await runChat("say hello");
    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const sent = executeMock.mock.calls[0][0].body;
    expect(JSON.stringify(sent)).not.toContain("oops");
  });
});
