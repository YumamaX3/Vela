// The content-filter law, proven at its boundaries.
//
// The dangerous half of this rule is over-detection: a filter matcher that fires on
// the word "sensitive" would retry ordinary answers. Every assertion below exists to
// pin the edge — exact match only, overflow disqualifies, tool or reasoning traffic
// disqualifies.
import { describe, expect, it } from "vitest";
import {
  ContentFilterDetector,
  isFilterText,
  isFilterError,
  FILTER_TEXT_LIMIT,
} from "../../open-sse/shared/codebuddy/contentFilter.js";

const CANNED =
  "抱歉，系统检测到您当前输入的信息存在敏感内容，我无法响应您的请求，请检查后重新输入";

describe("the canned refusal is matched exactly, after normalization", () => {
  it("matches the reference wording", () => {
    expect(isFilterText(CANNED)).toBe(true);
  });

  it("matches when whitespace and trailing punctuation differ", () => {
    expect(isFilterText(` ${CANNED}。 `)).toBe(true);
    expect(isFilterText(CANNED.replace(/，/g, ","))).toBe(true);
  });

  it("does NOT match ordinary prose that merely discusses sensitivity", () => {
    for (const text of [
      "The system detected sensitive content here.",
      "这是一段关于敏感内容的普通回答",
      `${CANNED} additionally, here is more`,
      "",
      null,
    ]) {
      expect(isFilterText(text)).toBe(false);
    }
  });
});

describe("explicit filter envelopes", () => {
  it("recognises error.code and error.type", () => {
    expect(isFilterError({ error: { code: "content_filter" } })).toBe(true);
    expect(isFilterError({ error: { type: "content-filter" } })).toBe(true);
  });

  it("recognises a canned error.message", () => {
    expect(isFilterError({ error: { message: CANNED } })).toBe(true);
  });

  it("is inert on unrelated errors and non-objects", () => {
    expect(isFilterError({ error: { code: "11128" } })).toBe(false);
    expect(isFilterError({ error: "boom" })).toBe(false);
    expect(isFilterError(null)).toBe(false);
  });
});

describe("the detector separates a pure refusal from real work", () => {
  it("detects a streamed canned refusal ending in a clean stop", () => {
    const d = new ContentFilterDetector()
      .feed({ content: CANNED.slice(0, 20) })
      .feed({ content: CANNED.slice(20) }, "stop");
    expect(d.detected).toBe(true);
    expect(d.retrySafe).toBe(true);
  });

  it("detects an explicit content_filter finish reason with no text", () => {
    const d = new ContentFilterDetector().feed({}, "content_filter");
    expect(d.detected).toBe(true);
    expect(d.retrySafe).toBe(true);
  });

  it("does NOT treat a normal answer as a refusal", () => {
    const d = new ContentFilterDetector()
      .feed({ content: "Here is the implementation you asked for." }, "stop");
    expect(d.detected).toBe(false);
    expect(d.retrySafe).toBe(false);
  });

  it("refuses to retry when the turn also carried tool calls", () => {
    const d = new ContentFilterDetector()
      .feed({ tool_calls: [{ index: 0, id: "call_1" }] })
      .feed({ content: CANNED }, "stop");
    expect(d.detected).toBe(true);
    expect(d.retrySafe).toBe(false);
  });

  it("refuses to retry when the turn also carried reasoning", () => {
    const d = new ContentFilterDetector()
      .feed({ reasoning_content: "thinking…" })
      .feed({ content: CANNED }, "stop");
    expect(d.detected).toBe(true);
    expect(d.retrySafe).toBe(false);
  });

  it("refuses to retry after the bounded window overflows", () => {
    const d = new ContentFilterDetector().feed({ content: "x".repeat(FILTER_TEXT_LIMIT + 1) });
    expect(d.overflow).toBe(true);
    expect(d.detected).toBe(false);
    expect(d.retrySafe).toBe(false);
  });

  it("refuses to retry when the refusal is followed by real content", () => {
    // Concatenated, the text is no longer the exact canned string — so this turn is
    // NOT a detectable refusal at all, which is the conservative answer: an ordinary
    // answer that happens to begin with the apology must never be retried.
    const d = new ContentFilterDetector()
      .feed({ content: CANNED })
      .feed({ content: " Actually, here is the answer." }, "stop");
    expect(d.retrySafe).toBe(false);
  });

  it("still flags an explicit code even when extra text follows", () => {
    // The explicit signal is authoritative: detected, but NOT retry-safe.
    const d = new ContentFilterDetector()
      .feed({ content: "partial output" })
      .feed({}, "content_filter");
    expect(d.detected).toBe(true);
    expect(d.retrySafe).toBe(false);
  });
});
