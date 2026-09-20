/**
 * W4 · Recovery — coercedSseHandler (sibling-harbor-ports §3.1 — FR-7).
 *
 * Some upstreams are coerced to non-streaming (NVIDIA NIM-hosted Kimi-k2.6/k2.7
 * degrade or return empty bodies when asked for SSE) while the client asked for
 * a stream. The upstream then answers with a single `chat.completion` JSON body
 * that cannot be piped through the SSE transform. This suite pins two claims:
 *
 *   · the pure synthesizer turns a non-stream JSON body into a well-formed SSE
 *     `data:` sequence ending in `data: [DONE]`;
 *   · the streaming handler actually engages it on the `application/json` path,
 *     so a JSON upstream response reaches an SSE client as a stream.
 */
import { describe, it, expect } from "vitest";
import { buildCoercedSSEResponse } from "../../open-sse/handlers/chatCore/coercedSseHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

async function drainSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

// A real coerced-upstream body: the JSON a Kimi-on-NVIDIA request returns when
// the upstream was asked for stream:false.
const NON_STREAM_BODY = {
  id: "chatcmpl-abc",
  created: 1700000000,
  model: "moonshotai/kimi-k2.6",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello world" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

/** Every non-empty line of a drained SSE body. */
function sseLines(text) {
  return text.split("\n").filter(Boolean);
}

/** Parse the JSON payload of every `data:` frame except the [DONE] sentinel. */
function dataPayloads(text) {
  return sseLines(text)
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice("data: ".length)));
}

describe("buildCoercedSSEResponse — well-formed SSE from a non-stream body", () => {
  it("emits SSE headers and a data: sequence ending in [DONE]", async () => {
    const res = buildCoercedSSEResponse(NON_STREAM_BODY);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const text = await drainSSE(res);
    const lines = sseLines(text);

    // Every frame is a `data:` frame; the last is the [DONE] sentinel.
    expect(lines.every((l) => l.startsWith("data: "))).toBe(true);
    expect(lines.at(-1)).toBe("data: [DONE]");
    // and exactly one [DONE].
    expect(lines.filter((l) => l === "data: [DONE]")).toHaveLength(1);

    const chunks = dataPayloads(text);
    // role delta, content delta, finish chunk
    expect(chunks.length).toBe(3);
    expect(chunks[0].object).toBe("chat.completion.chunk");
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant" });
    expect(chunks[1].choices[0].delta).toEqual({ content: "Hello world" });
    expect(chunks[2].choices[0].finish_reason).toBe("stop");
  });

  it("carries usage onto the finish chunk", async () => {
    const text = await drainSSE(buildCoercedSSEResponse(NON_STREAM_BODY));
    const finish = dataPayloads(text).find((c) => c.choices[0].finish_reason === "stop");
    expect(finish.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it("emits the role delta before the content delta", async () => {
    const text = await drainSSE(buildCoercedSSEResponse(NON_STREAM_BODY));
    expect(text.indexOf('"role":"assistant"')).toBeLessThan(text.indexOf('"content":"Hello world"'));
  });

  it("emits a reasoning_content delta when present", async () => {
    const text = await drainSSE(buildCoercedSSEResponse({
      id: "r", created: 1, model: "kimi-k2.6",
      choices: [{ index: 0, message: { role: "assistant", reasoning_content: "think...", content: "42" }, finish_reason: "stop" }],
    }));
    expect(text).toContain("think...");
    expect(text).toContain("42");
  });

  it("emits tool_calls and finish_reason tool_calls", async () => {
    const text = await drainSSE(buildCoercedSSEResponse({
      id: "t", created: 1, model: "kimi-k2.6",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } }] },
        finish_reason: "tool_calls",
      }],
    }));
    expect(text).toContain('"tool_calls"');
    expect(text).toContain('"bash"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text).toContain("data: [DONE]");
  });

  it("falls back to a single raw frame + [DONE] when there is no message", async () => {
    const text = await drainSSE(buildCoercedSSEResponse({ object: "error", message: "upstream exploded" }));
    expect(text).toContain("upstream exploded");
    expect(sseLines(text).at(-1)).toBe("data: [DONE]");
  });
});

// ── the streaming handler engages the synthesizer on the application/json path ──

function streamingCtx(providerResponse) {
  return {
    providerResponse,
    provider: "nvidia",
    model: "moonshotai/kimi-k2.6",
    sourceFormat: "openai",
    targetFormat: "openai",
    userAgent: "test-agent",
    body: { model: "moonshotai/kimi-k2.6", stream: true, messages: [{ role: "user", content: "hi" }] },
    stream: true,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "c1",
    apiKey: "k",
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: {} },
    reqLogger: {
      logProviderResponse() {}, logConvertedResponse() {}, logError() {},
      appendConvertedChunk() {}, appendProviderChunk() {}, appendOpenAIChunk() {},
    },
    toolNameMap: null,
    customToolNames: null,
    streamController: { signal: undefined, handleComplete() {}, handleError() {}, handleDisconnect() {} },
    onStreamComplete: null,
    streamDetailId: "sd1",
    pxpipe: null,
    reqTag: "t",
    log: { line() {}, errorLine() {}, debug() {}, info() {}, warn() {}, error() {} },
    combo: null,
  };
}

describe("handleStreamingResponse — coerced JSON upstream is re-streamed as SSE", () => {
  it("returns an SSE Response (not a raw JSON body) for an application/json upstream", async () => {
    const upstream = new Response(JSON.stringify(NON_STREAM_BODY), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await handleStreamingResponse(streamingCtx(upstream));

    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    const text = await drainSSE(result.response);
    expect(text).toContain("Hello world");
    expect(sseLines(text).at(-1)).toBe("data: [DONE]");
  });

  it("normalizes leaked Kimi markup in the coerced JSON before streaming", async () => {
    const leaked = {
      id: "chatcmpl-leak",
      created: 1700000001,
      model: "moonshotai/kimi-k2.6",
      choices: [{
        index: 0,
        message: { role: "assistant", content: 'Let me check  functions.bash:0 {"command":"ls"}' },
        finish_reason: "stop",
      }],
    };
    const upstream = new Response(JSON.stringify(leaked), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await handleStreamingResponse(streamingCtx(upstream));
    const text = await drainSSE(result.response);
    const chunks = dataPayloads(text);
    // the raw markup never reaches the client as content; a tool_calls delta replaces it
    const contentDeltas = chunks.map((c) => c.choices[0].delta.content).filter((c) => typeof c === "string");
    expect(contentDeltas.join("")).toBe("Let me check");
    expect(contentDeltas.some((c) => c.includes("functions.bash:0"))).toBe(false);
    expect(chunks.some((c) => c.choices[0].delta.tool_calls?.some((t) => t.function.name === "bash"))).toBe(true);
  });
});
