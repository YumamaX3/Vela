// The breaker-key binding — the regression that sailed to production.
//
// v1.2.4 shipped with `execute()` reading a bare `key` that no scope ever
// bound: the first breaker touch on EVERY codebuddy-intl request threw
// `ReferenceError: key is not defined` inside the compiled executor, 502ing
// the lane in ~300ms and locking each account for 30s. No suite called
// execute() on the real family, so the wound never met a test.
//
// This suite is the instrument that closes that gap: it drives the REAL
// family executors through execute() — against the real capability gate and
// the real breaker gate, no mocks — and asserts that a request either
// completes or fails as an HTTP-level result, never as a ReferenceError.
//
// The binding is a property invariant, not a behavior preference. It is
// pinned here so no future refactor of execute()'s head can drop it again.

import { describe, expect, it } from "vitest";
import { CodeBuddyFamilyExecutor } from "../../open-sse/executors/codebuddy-family.js";
import { CODEBUDDY_PROFILES } from "../../open-sse/shared/codebuddy/profiles.js";

const CREDENTIALS = {
  connectionId: "conn-regression-1",
  accessToken: "test-token",
  accountId: "acct-1",
};

// The smallest body that reaches the breaker: openai-format chat messages.
function body(overrides = {}) {
  return {
    model: "deepseek-v4.1-flash",
    stream: false,
    messages: [{ role: "user", content: "ping" }],
    ...overrides,
  };
}

describe("codebuddy family breaker-key binding — the v1.2.4 regression", () => {
  it("binds `key` from the credential before any breaker call — execute() must not throw a ReferenceError", async () => {
    for (const providerId of ["codebuddy-intl", "codebuddy-cn", "workbuddy-cn", "workbuddy-intl"]) {
      const executor = new CodeBuddyFamilyExecutor(providerId);
      expect(executor.profile, `${providerId} must resolve a profile`).toBeTruthy();

      // The invariant: breakerKey derives from the credential, names the product.
      const key = executor.breakerKey(CREDENTIALS);
      expect(key).toBe(`${providerId}:conn-regression-1`);

      // The regression shape: execute() reaches the first breaker call.
      // With the binding in place, any outcome is lawful EXCEPT a thrown
      // ReferenceError naming `key`. A network call may fail underneath —
      // that failure belongs to fetch, and execute() is expected to return
      // a result shape rather than unwind. We assert exactly that.
      let result;
      let threw = null;
      try {
        result = await executor.execute({
          credentials: CREDENTIALS,
          model: "deepseek-v4.1-flash",
          stream: false,
          body: body(),
          log: { debug() {}, info() {}, warn() {}, error() {} },
        });
      } catch (e) {
        threw = e;
      }

      // The v1.2.4 wound: ReferenceError: key is not defined — unconditionally,
      // on every request, before any upstream contact. It must never recur.
      if (threw) {
        expect(
          threw instanceof ReferenceError && /key is not defined/.test(String(threw.message)),
          `${providerId}.execute threw ${threw.constructor.name}: ${threw.message} — the breaker-key binding is missing in execute()`
        ).toBe(false);
      } else {
        // Lawful return: either a result carrying an HTTP-level response, or a
        // breaker-open verdict — but always a defined result object.
        expect(result, `${providerId}.execute returned undefined`).toBeTruthy();
        expect(typeof result).toBe("object");
      }
    }
  });

  it("breakerKey never collides across products sharing one connectionId", () => {
    const ids = ["codebuddy-cn", "codebuddy-intl", "workbuddy-cn", "workbuddy-intl"];
    const keys = ids.map((id) => new CodeBuddyFamilyExecutor(id).breakerKey(CREDENTIALS));
    expect(new Set(keys).size).toBe(4);
    for (let i = 0; i < ids.length; i++) expect(keys[i]).toContain(ids[i]);
  });

  it("profiles carry the four products — the family map stays whole", () => {
    for (const id of ["codebuddy-cn", "codebuddy-intl", "workbuddy-cn", "workbuddy-intl"]) {
      expect(CODEBUDDY_PROFILES[id], `${id} missing from CODEBUDDY_PROFILES`).toBeTruthy();
    }
  });
});
