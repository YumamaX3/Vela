/**
 * Session-scarce model-test guard — a freebuff test request must soft-skip
 * BEFORE any fetch (a fetch would traverse the chat path and claim a session,
 * burning one of ~6 daily quota units; "test all" would incinerate them all).
 */
import { describe, expect, it } from "vitest";

import { isSessionScarceTestTarget } from "../../src/app/api/models/test/sessionScarce.js";

describe("isSessionScarceTestTarget", () => {
  it("matches prefixed freebuff model ids", () => {
    expect(isSessionScarceTestTarget("freebuff/mimo/mimo-v2.5")).toBe(true);
    expect(isSessionScarceTestTarget("freebuff/deepseek/deepseek-v4-flash")).toBe(true);
    expect(isSessionScarceTestTarget("fb/mimo/mimo-v2.5")).toBe(true);
  });

  it("matches via the explicit provider argument", () => {
    expect(isSessionScarceTestTarget("mimo/mimo-v2.5", "freebuff")).toBe(true);
    expect(isSessionScarceTestTarget("mimo/mimo-v2.5", "fb")).toBe(true);
  });

  it("does not match other providers", () => {
    expect(isSessionScarceTestTarget("grok-cli/grok-build")).toBe(false);
    expect(isSessionScarceTestTarget("mimo/mimo-v2.5", "mimo")).toBe(false);
    expect(isSessionScarceTestTarget("")).toBe(false);
    expect(isSessionScarceTestTarget(null)).toBe(false);
  });
});
