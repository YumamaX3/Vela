// GUARDRAILS AT THE CHAT CORE — the tap is only real if a configured policy
// changes what the executor sends and what the client receives.
//
// The scanner and the stream filter are proven apart. This suite proves the
// WIRING: a global block stops dispatch before the provider is called; a mask
// hands the executor a rewritten body; an outbound block becomes 451 (never a
// retryable 502), and an outbound mask rewrites the completion.
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

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  line: vi.fn(),
  errorLine: vi.fn(),
};

async function clearPolicies() {
  for (const policy of await store.listPolicies()) await store.deletePolicy(policy.id);
}

function chatBody(content) {
  return {
    model: "deepseek/deepseek-chat",
    stream: false,
    messages: [{ role: "user", content }],
  };
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
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body: {},
      headers: { accept: "application/json" },
    },
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

beforeEach(async () => {
  vi.clearAllMocks();
  await clearPolicies();
  store.__test__.invalidateCache();
  executeMock.mockResolvedValue(completion("all clear"));
});

afterAll(() => {
  try { driver.resetAdapter(); } catch { /* closed */ }
});

describe("inbound wiring", () => {
  it("blocks before dispatch — the provider never sees the request", async () => {
    await store.createPolicy({ name: "block pii", scope: "global", direction: "inbound", detectors: ["pii"], action: "block" });

    const result = await runChat("mail ada@example.com");
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/guardrail policy/);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("masks the body the executor actually receives", async () => {
    await store.createPolicy({ name: "mask pii", scope: "global", direction: "inbound", detectors: ["pii"], action: "mask" });

    const result = await runChat("mail ada@example.com");
    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const sent = executeMock.mock.calls[0][0].body;
    const sentText = JSON.stringify(sent);
    expect(sentText).not.toContain("ada@example.com");
    expect(sentText).toContain("[REDACTED]");
  });
});

describe("outbound wiring", () => {
  it("blocking the answer returns 451, not a retryable 502", async () => {
    await store.createPolicy({ name: "block out", scope: "global", direction: "outbound", detectors: ["pii"], action: "block" });
    executeMock.mockResolvedValue(completion("mail ada@example.com"));

    const result = await runChat("hello");
    expect(result.success).toBe(false);
    expect(result.status).toBe(451);
    expect(result.error).toMatch(/Response blocked/);
  });

  it("masks the completion the client receives", async () => {
    await store.createPolicy({ name: "mask out", scope: "global", direction: "outbound", detectors: ["pii"], action: "mask" });
    executeMock.mockResolvedValue(completion("mail ada@example.com"));

    const result = await runChat("hello");
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("mail [REDACTED]");
  });
});
