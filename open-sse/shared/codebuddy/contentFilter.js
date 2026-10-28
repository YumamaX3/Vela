// CodeBuddy's content-filter refusal — a blocked turn wearing a clean stop.
//
// When the upstream refuses on sensitivity grounds it does not raise: it streams
// a canned apology and closes with `finish_reason: "stop"`, exactly as a real
// answer would. Downstream that is indistinguishable from success — the combo logs
// "anchored", the member is never advanced past, and the caller receives the
// refusal as though it were the model's reply.
//
// Carried from the reference gateway (codebuddy2api, app/content_filter.py), whose
// discipline is worth keeping whole:
//
//   1. THE SIGNAL IS EITHER EXPLICIT OR TEXTUAL. An explicit `content_filter` code
//      (on the error envelope or the finish reason) counts. Otherwise the text must
//      match the canned refusal EXACTLY once normalized — whitespace collapsed,
//      commas unified, trailing punctuation dropped. Substring matching on words
//      like "sensitive" would flag every ordinary answer that discusses them.
//
//   2. RETRY IS SAFE ONLY FOR A PURE REFUSAL. If the stream also carried tool calls
//      or reasoning, or if more text arrived than the bounded window could hold,
//      the turn is not a pure refusal and must not be retried — the model may have
//      been mid-work, and replaying it would double-spend the call.

/** The upstream's canned refusal, normalized at comparison time. */
const FILTER_REPLY = "抱歉，系统检测到您当前输入的信息存在敏感内容，我无法响应您的请求，请检查后重新输入";

const FILTER_CODES = new Set(["content_filter", "content-filter"]);

/** How much of the streamed text this detector will hold. */
export const FILTER_TEXT_LIMIT = 1024;

/**
 * Normalize for comparison: strip all whitespace, unify commas, drop trailing
 * sentence punctuation. Applied to both sides, so a stream that breaks the same
 * sentence across frames still matches.
 */
function normalize(text) {
  return String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/,/g, "，")
    .replace(/[。.!！]+$/, "");
}

/** Is this text exactly the canned refusal? */
export function isFilterText(text) {
  return normalize(text) === normalize(FILTER_REPLY);
}

/**
 * Is this parsed JSON body an explicit filter error?
 * Reads `error.code`, `error.type`, and `error.message`.
 */
export function isFilterError(payload) {
  if (!payload || typeof payload !== "object") return false;
  const error = payload.error;
  if (!error || typeof error !== "object") return false;
  if (typeof error.code === "string" && FILTER_CODES.has(error.code)) return true;
  if (typeof error.type === "string" && FILTER_CODES.has(error.type)) return true;
  return typeof error.message === "string" && isFilterText(error.message);
}

/**
 * Accumulates a streamed turn just far enough to decide whether it was a refusal.
 *
 * Fed one delta at a time. Bounded: only the first FILTER_TEXT_LIMIT characters of
 * each text channel are held, and any overflow permanently disqualifies the turn
 * from being treated as a pure refusal.
 */
export class ContentFilterDetector {
  constructor() {
    this.text = { content: "", refusal: "" };
    this.overflow = false;
    this.hasTools = false;
    this.hasReasoning = false;
    this.explicit = false;
  }

  /**
   * @param {object} delta - The OpenAI-shaped delta for this frame.
   * @param {string|null} finishReason
   */
  feed(delta, finishReason = null) {
    if (typeof finishReason === "string" && FILTER_CODES.has(finishReason)) {
      this.explicit = true;
    }
    if (delta && typeof delta === "object") {
      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) this.hasTools = true;
      if (delta.reasoning_content) this.hasReasoning = true;
      for (const key of Object.keys(this.text)) {
        const part = typeof delta[key] === "string" ? delta[key] : "";
        const remaining = FILTER_TEXT_LIMIT - this.text[key].length;
        if (part.length > remaining) this.overflow = true;
        this.text[key] += part.slice(0, Math.max(0, remaining));
      }
    }
    return this;
  }

  /** Was this turn a refusal at all — explicit, or an exact canned match in window? */
  get detected() {
    if (this.explicit) return true;
    if (this.overflow) return false;
    return Object.values(this.text).some((text) => isFilterText(text));
  }

  /**
   * May this refusal be retried on another member?
   *
   * Only when it is a pure refusal: no overflow, no tool calls, no reasoning, and
   * every text channel is either blank or exactly the canned apology.
   */
  get retrySafe() {
    if (!this.detected) return false;
    if (this.overflow || this.hasTools || this.hasReasoning) return false;
    return Object.values(this.text).every((text) => !text.trim() || isFilterText(text));
  }
}
