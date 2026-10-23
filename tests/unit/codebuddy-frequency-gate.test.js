// The 6004 frequency limit arrives as a business envelope inside a 200 body.
// Without a taxonomy entry the gate emitted a Response with status 6004 — an
// invalid HTTP status — so the frequency limit never reached the classifier as
// a 429 and the account was never cooled down.
import { describe, expect, it } from "vitest";
import {
  CODEBUDDY_BUSINESS_CODE_HTTP,
  CODEBUDDY_RETRYABLE_CODES,
  businessCodeToHttpStatus,
  businessCodeLabel,
} from "../../open-sse/shared/codebuddy/gate.js";

describe("codebuddy business-code taxonomy", () => {
  it("maps 6004 to an honest 429", () => {
    expect(businessCodeToHttpStatus(6004)).toBe(429);
    expect(businessCodeLabel(6004)).toBe("frequency");
  });

  it("treats 6004 as retryable", () => {
    expect(CODEBUDDY_RETRYABLE_CODES.has(6004)).toBe(true);
  });

  it("keeps the existing taxonomy intact", () => {
    expect(CODEBUDDY_BUSINESS_CODE_HTTP[14018]).toBe(429);
    expect(businessCodeToHttpStatus(11101)).toBe(400);
    expect(businessCodeToHttpStatus(11140)).toBe(403);
    expect(businessCodeToHttpStatus(99999)).toBe(502);
  });
});
