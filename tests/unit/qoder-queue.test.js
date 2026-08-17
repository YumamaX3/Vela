/**
 * Unit tests for the qoder queue gate (code 10605 — queue admission).
 *
 * A saturated qoder lane answers the first SSE frame with statusCodeValue
 * 403 and a body carrying the admission ticket:
 *   {"code":"10605","message":"{\"isQueued\":true,\"modelKey\":\"qmodel_38max\",
 *    \"queueCount\":7722,\"queueType\":\"slow\",\"retryAfterSeconds\":30,...}"}
 * The ticket is queue admission, NOT a billing block — the gateway must wait
 * retryAfterSeconds and re-issue the identical signed request until the lane
 * admits it, then surface an honest 429 when the wait budget exhausts.
 *
 * These are the two shapes the Star observed in production (2026-08-17):
 *   1. deep queue  — isQueued:true,  queueCount:7722, retryAfterSeconds:30+
 *   2. lane nearly clear — isQueued:false, queueCount:0, retryAfterSeconds:0
 */

import { describe, it, expect } from "vitest";
import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";

const {
  parseQueueAdmission,
  queueWaitMs,
  isBillingBlock,
  wrapQoderSSE,
  QODER_QUEUE_MAX_WAIT_S,
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

describe("parseQueueAdmission — the 10605 ticket parser", () => {
  // The exact shape the Star observed (queue fields nested ONE level inside
  // the message string — the outermost envelope already stripped by peek).
  const REAL_TICKET =
    '{"code":"10605","message":"{\\"isQueued\\":true,\\"modelKey\\":\\"qmodel_38max\\",\\"queueCount\\":7722,\\"queueType\\":\\"slow\\",\\"retryAfterSeconds\\":30}"}';
  // The deepest plausible nesting — queue fields inside message inside message.
  const DEEP_TICKET =
    '{"code":"10605","message":"{\\"code\\":\\"10605\\",\\"message\\":\\"{\\\\\\"isQueued\\\\\\":true,\\\\\\"queueCount\\\\\\":0,\\\\\\"retryAfterSeconds\\\\\\":0}\\"}"}';

  it("parses the observed production ticket (nested one level)", () => {
    const a = parseQueueAdmission(REAL_TICKET);
    expect(a).not.toBeNull();
    expect(a.isQueued).toBe(true);
    expect(a.modelKey).toBe("qmodel_38max");
    expect(a.queueCount).toBe(7722);
    expect(a.queueType).toBe("slow");
    expect(a.retryAfterSeconds).toBe(30);
  });

  it("parses arbitrarily deep nesting (fields three levels in)", () => {
    const a = parseQueueAdmission(DEEP_TICKET);
    expect(a).not.toBeNull();
    expect(a.isQueued).toBe(true);
    expect(a.queueCount).toBe(0);
    expect(a.retryAfterSeconds).toBe(0);
  });

  it("parses the lane-nearly-clear shape (isQueued:false, retryAfterSeconds:0)", () => {
    const ticket =
      '{"code":"10605","message":"{\\"isQueued\\":false,\\"modelKey\\":\\"qmodel_38max\\",\\"queueCount\\":0,\\"queueType\\":\\"slow\\",\\"retryAfterSeconds\\":0}"}';
    const a = parseQueueAdmission(ticket);
    expect(a).not.toBeNull();
    expect(a.isQueued).toBe(false);
    expect(a.queueCount).toBe(0);
    expect(a.retryAfterSeconds).toBe(0);
  });

  it("returns null for non-10605 bodies", () => {
    expect(parseQueueAdmission('{"code":"112","message":"Quota exhausted"}')).toBeNull();
    expect(parseQueueAdmission('{"code":"500","message":"Internal error"}')).toBeNull();
    expect(parseQueueAdmission("plain text, no code")).toBeNull();
  });

  it("returns null for empty or non-string input", () => {
    expect(parseQueueAdmission("")).toBeNull();
    expect(parseQueueAdmission(null)).toBeNull();
    expect(parseQueueAdmission(undefined)).toBeNull();
    expect(parseQueueAdmission(10605)).toBeNull();
  });

  it("tolerates partial tickets — missing fields come back null, not NaN", () => {
    const a = parseQueueAdmission('{"code":"10605","message":"weird partial shape"}');
    expect(a).not.toBeNull();
    expect(a.retryAfterSeconds).toBeNull();
    expect(a.queueCount).toBeNull();
    expect(a.queueType).toBeNull();
    expect(a.modelKey).toBeNull();
    expect(a.isQueued).toBe(false);
  });
});

describe("queueWaitMs — honoring the server's instruction, with a cap", () => {
  it("honors retryAfterSeconds exactly", () => {
    expect(queueWaitMs({ retryAfterSeconds: 5 }, 1)).toBe(5000);
    expect(queueWaitMs({ retryAfterSeconds: 30 }, 2)).toBe(30000);
  });

  it("caps retryAfterSeconds at the ceiling (a wedged upstream must not hang us)", () => {
    expect(queueWaitMs({ retryAfterSeconds: 999 }, 1)).toBe(QODER_QUEUE_MAX_WAIT_S * 1000);
    expect(queueWaitMs({ retryAfterSeconds: 3600 }, 3)).toBe(QODER_QUEUE_MAX_WAIT_S * 1000);
  });

  it("falls back to exponential backoff when the server gives no wait", () => {
    expect(queueWaitMs({ retryAfterSeconds: 0 }, 1)).toBe(2000);
    expect(queueWaitMs({ retryAfterSeconds: null }, 2)).toBe(4000);
    expect(queueWaitMs(null, 3)).toBe(8000);
    expect(queueWaitMs({}, 1)).toBe(2000);
  });

  it("caps the backoff at 10s", () => {
    expect(queueWaitMs({ retryAfterSeconds: 0 }, 5)).toBe(10000);
    expect(queueWaitMs(null, 9)).toBe(10000);
  });
});

describe("the 10605 classification boundary — queue, never billing", () => {
  it("10605 is NOT a billing block", () => {
    expect(isBillingBlock('{"code":"10605","message":"Queue limit"}')).toBe(false);
    expect(isBillingBlock('{"code":"10605","message":"{\\"isQueued\\":true}"}')).toBe(false);
  });

  it("billing signatures still classify as billing", () => {
    expect(isBillingBlock('{"code":"112","message":"Quota exhausted"}')).toBe(true);
    expect(isBillingBlock('{"message":"Upgrade","pricingUrl":"https://qoder.sh/pricing"}')).toBe(true);
  });
});

describe("wrapQoderSSE — the queue marker on the first frame", () => {
  it("marks a 10605 first frame as a queue admission with parsed fields", async () => {
    const ticket =
      '{"code":"10605","message":"{\\"isQueued\\":true,\\"modelKey\\":\\"qmodel_38max\\",\\"queueCount\\":7722,\\"queueType\\":\\"slow\\",\\"retryAfterSeconds\\":30}"}';
    const wrapped = await wrapQoderSSE(makeResponse([sseLine(403, ticket)]), "qoder/qmodel_38max");

    expect(wrapped.queue).toBeDefined();
    expect(wrapped.queue.admission.isQueued).toBe(true);
    expect(wrapped.queue.admission.modelKey).toBe("qmodel_38max");
    expect(wrapped.queue.admission.queueCount).toBe(7722);
    expect(wrapped.queue.admission.queueType).toBe("slow");
    expect(wrapped.queue.admission.retryAfterSeconds).toBe(30);
    // Not an error response — the queue is an admission signal, not a failure.
    expect(wrapped.status).toBe(200);
  });

  it("a 10605 ticket never becomes a 403 billing response", async () => {
    const ticket = '{"code":"10605","message":"{\\"isQueued\\":false,\\"retryAfterSeconds\\":0}"}';
    const wrapped = await wrapQoderSSE(makeResponse([sseLine(403, ticket)]), "qoder/qmodel_38max");
    expect(wrapped.status).not.toBe(403);
    expect(wrapped.queue).toBeDefined();
  });

  it("normal first frames carry no queue marker", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    const wrapped = await wrapQoderSSE(makeResponse([sseLine(200, inner)]), "qoder/auto");
    expect(wrapped.queue).toBeUndefined();
    expect(wrapped.status).toBe(200);
  });

  it("billing frames still return 403 (unchanged covenant)", async () => {
    const wrapped = await wrapQoderSSE(
      makeResponse([sseLine(403, '{"code":"112","message":"Quota exhausted","pricingUrl":"https://qoder.sh/pricing"}')]),
      "qoder/ultimate",
    );
    expect(wrapped.status).toBe(403);
    expect(wrapped.queue).toBeUndefined();
  });
});
