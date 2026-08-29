/**
 * Unit tests for the qoder error gate ascension (v0.9.30).
 *
 * The six error shapes observed in production (2026-08-29):
 *   1. [qoder error 400] upstream error (400)               — first frame, generic 4xx
 *   2. [qoder error 504] upstream model timed out (504)      — first frame, timeout
 *   3. [qoder error 403] upstream error (403)                — first frame, plain 403
 *   4. [qoder error 418] {...provider_error...}              — first frame, teapot envelope
 *   5. [qoder error 403] {...code 112 pricingUrl...}         — billing/quota block
 *   6. [qoder error 403] {...code 10605 isQueued...}         — queue admission ticket
 *
 * Before this ascension, shapes 1-4 were laundered into 200 streams —
 * chatCore saw success, no combo fallback fired, and clients ate the raw
 * error text. The gate now surfaces first-frame errors as honest non-200
 * responses; mid-stream errors keep graceful degradation (error chunk +
 * [DONE]) because partial work is already on the client.
 */

import { describe, it, expect } from "vitest";
import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";

const {
  wrapQoderSSE,
  classifyHttpError,
  classifyQoderError,
  extractInnerDetail,
  describeQueueAdmission,
  QODER_QUEUE_BUDGET_MS,
  QODER_RETRY_BACKOFF_MS,
} = qoderExecutorInternals;

// Helper: build a qoder SSE envelope line from a statusCodeValue + body.
function sseLine(statusCodeValue, body) {
  return `data: ${JSON.stringify({ statusCodeValue, body })}\n\n`;
}

function makeResponse(lines, { status = 200 } = {}) {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status });
}

async function drain(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  return buf + decoder.decode();
}

describe("extractInnerDetail — peeling nested error envelopes", () => {
  it("peels one level of JSON nesting to the deepest human message", () => {
    const raw = '{"code":"418","message":"{\\"code\\":\\"provider_error\\",\\"message\\":\\"Error in upstream response\\"}"}';
    const detail = extractInnerDetail(raw);
    // Peels to the deepest message string — the code ("provider_error") is
    // already carried by the classifier prefix ("upstream provider error (418)").
    expect(detail).toBe("Error in upstream response");
  });

  it("peels multiple levels of nesting", () => {
    const raw = '{"message":"{\\"message\\":\\"{\\"code\\":\\"112\\",\\"message\\":\\"quota exhausted\\"}\\"}"}';
    const detail = extractInnerDetail(raw);
    expect(detail).toContain("quota exhausted");
  });

  it("returns plain text unchanged (trimmed, newlines collapsed)", () => {
    expect(extractInnerDetail("upstream model timeout")).toBe("upstream model timeout");
    expect(extractInnerDetail("line one\nline two")).toBe("line one line two");
  });

  it("caps detail length so a pathological body cannot flood the client", () => {
    const detail = extractInnerDetail("x".repeat(1000));
    expect(detail.length).toBeLessThanOrEqual(200);
  });

  it("returns empty for empty or non-string input", () => {
    expect(extractInnerDetail("")).toBe("");
    expect(extractInnerDetail(null)).toBe("");
    expect(extractInnerDetail(undefined)).toBe("");
    expect(extractInnerDetail(42)).toBe("");
  });
});

describe("classifyHttpError — the HTTP-level retry policy", () => {
  it("marks transient statuses retryable", () => {
    for (const s of [408, 429, 500, 502, 503, 504, 522, 524, 529]) {
      const c = classifyHttpError(s);
      expect(c.retryable, `status ${s} should be retryable`).toBe(true);
    }
  });

  it("marks auth failures non-retryable with a reconnect message", () => {
    const c401 = classifyHttpError(401);
    const c403 = classifyHttpError(403);
    expect(c401.retryable).toBe(false);
    expect(c403.retryable).toBe(false);
    expect(c401.message).toContain("reconnect");
    expect(c403.message).toContain("reconnect");
  });

  it("marks 402 as billing", () => {
    expect(classifyHttpError(402).kind).toBe("billing");
    expect(classifyHttpError(402).retryable).toBe(false);
  });

  it("marks generic 4xx non-retryable", () => {
    expect(classifyHttpError(400).retryable).toBe(false);
    expect(classifyHttpError(404).retryable).toBe(false);
    expect(classifyHttpError(400).message).toContain("400");
  });

  it("classifies 504/529 as timeouts in the message", () => {
    expect(classifyHttpError(504).message).toContain("timed out");
    expect(classifyHttpError(529).message).toContain("timed out");
  });
});

describe("classifyQoderError — envelope classification stays stable", () => {
  it("queue (10605) is retryable", () => {
    const c = classifyQoderError(403, '{"code":"10605","message":"..."}');
    expect(c.kind).toBe("queue");
    expect(c.retryable).toBe(true);
  });

  it("billing (112/pricingUrl) is not retryable", () => {
    expect(classifyQoderError(403, '{"code":"112"}').kind).toBe("billing");
    expect(classifyQoderError(403, '{"pricingUrl":"..."}').retryable).toBe(false);
  });

  it("timeout codes are retryable", () => {
    expect(classifyQoderError(504, "").kind).toBe("timeout");
    expect(classifyQoderError(504, "").retryable).toBe(true);
    expect(classifyQoderError(529, "").retryable).toBe(true);
  });

  it("teapot (418) is retryable", () => {
    const c = classifyQoderError(418, '{"code":"provider_error"}');
    expect(c.kind).toBe("teapot");
    expect(c.retryable).toBe(true);
  });

  it("5xx is retryable, 4xx is not", () => {
    expect(classifyQoderError(500, "").retryable).toBe(true);
    expect(classifyQoderError(400, "").retryable).toBe(false);
  });
});

describe("wrapQoderSSE — the six production error shapes", () => {
  it("shape 1: first-frame 400 becomes an honest 400 response", async () => {
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(400, "Bad request: model config mismatch")]),
      "qoder/auto",
    );
    expect(wrapped.status).toBe(400);
    expect(wrapped.ok).toBe(false);
    const json = await wrapped.json();
    expect(json.error.message).toContain("400");
    expect(json.error.message).toContain("model config mismatch");
  });

  it("shape 2: first-frame 504 timeout becomes an honest 504 response", async () => {
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(504, "upstream model timeout")]),
      "qoder/auto",
    );
    expect(wrapped.status).toBe(504);
    expect(wrapped.ok).toBe(false);
    const json = await wrapped.json();
    expect(json.error.message).toContain("timed out");
  });

  it("shape 3: first-frame plain 403 becomes an honest 403 response", async () => {
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(403, "forbidden")]),
      "qoder/auto",
    );
    expect(wrapped.status).toBe(403);
    expect(wrapped.ok).toBe(false);
    const json = await wrapped.json();
    expect(json.error.message).toContain("forbidden");
  });

  it("shape 4: first-frame 418 provider_error becomes an honest 418 response with the peeled detail", async () => {
    const envelopeBody =
      '{"code":"provider_error","message":"Error in upstream response"}';
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(418, envelopeBody)]),
      "qoder/auto",
    );
    expect(wrapped.status).toBe(418);
    expect(wrapped.ok).toBe(false);
    const json = await wrapped.json();
    expect(json.error.message).toContain("418");
    expect(json.error.message).toContain("Error in upstream response");
  });

  it("shape 5: billing block (112) still surfaces as 403 (unchanged covenant)", async () => {
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(403, '{"code":"112","message":"Quota exhausted","pricingUrl":"https://qoder.sh/pricing"}')]),
      "qoder/ultimate",
    );
    expect(wrapped.status).toBe(403);
    const json = await wrapped.json();
    expect(json.error.message).toContain("112");
  });

  it("shape 6: queue admission (10605) still carries the queue marker (unchanged covenant)", async () => {
    const ticket =
      '{"code":"10605","message":"{\\"isQueued\\":true,\\"modelKey\\":\\"qmodel_38max\\",\\"queueCount\\":8163,\\"queueType\\":\\"slow\\",\\"retryAfterSeconds\\":30}"}';
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(403, ticket)]),
      "qoder/qmodel_38max",
    );
    expect(wrapped.queue).toBeDefined();
    expect(wrapped.queue.admission.isQueued).toBe(true);
    expect(wrapped.queue.admission.queueCount).toBe(8163);
    expect(wrapped.queue.admission.retryAfterSeconds).toBe(30);
    expect(wrapped.status).toBe(200);
  });

  it("successful streams are untouched by the gate", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "hello" } }] });
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(200, inner)]),
      "qoder/auto",
    );
    expect(wrapped.status).toBe(200);
    expect(wrapped.ok).toBe(true);
    const out = await drain(wrapped);
    expect(out).toContain(`data: ${inner}`);
    expect(out).toContain("data: [DONE]");
  });

  it("mid-stream errors keep graceful degradation (chunk + [DONE], no launder)", async () => {
    const okInner = JSON.stringify({ choices: [{ delta: { content: "partial" } }] });
    const wrapped = await wrapQoderSSE(
      makeResponse([
        sseLine(200, okInner),
        sseLine(418, '{"code":"provider_error","message":"Error in upstream response"}'),
      ]),
      "qoder/auto",
    );
    expect(wrapped.status).toBe(200); // content already flowed — the stream stays
    const out = await drain(wrapped);
    expect(out).toContain("partial");
    expect(out).toContain("[qoder error 418");
    expect(out).toContain("Error in upstream response"); // detail peeled into the visible chunk
    expect(out).toContain("data: [DONE]");
  });
});

describe("describeQueueAdmission — honest exhaustion reasons", () => {
  it("carries the admission fields and the exhaustion reason", () => {
    const reason = describeQueueAdmission(
      { modelKey: "qmodel_38max", queueType: "slow", queueCount: 8163, retryAfterSeconds: 30 },
      4,
      "queue wait budget exhausted after 90s",
    );
    expect(reason).toContain("qmodel_38max");
    expect(reason).toContain("lane=slow");
    expect(reason).toContain("queue=8163");
    expect(reason).toContain("4 attempts");
    expect(reason).toContain("budget exhausted");
  });

  it("handles a null admission gracefully", () => {
    const reason = describeQueueAdmission(null, 2, "lane never admitted the request");
    expect(reason).toContain("2 attempts");
    expect(reason).toContain("never admitted");
  });
});

describe("the retry + budget constants", () => {
  it("the queue budget is a real wall-clock cap (90s)", () => {
    expect(QODER_QUEUE_BUDGET_MS).toBe(90_000);
  });

  it("HTTP retries are capped at two backoff waits (2s, 5s)", () => {
    expect(QODER_RETRY_BACKOFF_MS).toEqual([2000, 5000]);
  });
});
