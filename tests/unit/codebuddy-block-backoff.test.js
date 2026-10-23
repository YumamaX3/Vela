// CodeBuddy Intl refuses a request with HTTP 400 "request illegal" or
// "conversation id missing". Those messages matched no rule, so they fell
// through to the request-scoped 4xx rule: the connection got zero cooldown and
// its backoff level never moved. Provider-scoped rules let the connection back
// off while the combo still advances to the next member.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { ERROR_RULES } from "../../open-sse/config/errorConfig.js";

describe("codebuddy-intl block backoff", () => {
  it("backs off on the intl gateway's block wording", () => {
    for (const text of ["request illegal", "Request ILLEGAL from your region", "conversation id missing"]) {
      const r = checkFallbackError(400, text, 0, "codebuddy-intl");
      expect(r.shouldFallback).toBe(true);
      expect(r.cooldownMs).toBeGreaterThan(0);
      expect(r.requestScoped).toBeUndefined();
    }
  });

  it("resolves the cbai alias to the same rule", () => {
    const r = checkFallbackError(400, "request illegal", 0, "codebuddy-intl");
    expect(r.shouldFallback).toBe(true);
  });

  it("still reads the same wording as request-scoped for other providers", () => {
    const r = checkFallbackError(400, "request illegal", 0, "codebuddy-cn");
    expect(r.shouldFallback).toBe(false);
    expect(r.requestScoped).toBe(true);
  });

  it("escalates the backoff level across repeats", () => {
    const first = checkFallbackError(400, "request illegal", 0, "codebuddy-intl");
    const second = checkFallbackError(400, "request illegal", first.newBackoffLevel, "codebuddy-intl");
    expect(second.newBackoffLevel).toBeGreaterThan(first.newBackoffLevel);
    expect(second.cooldownMs).toBeGreaterThan(first.cooldownMs);
  });

  it("declares the rules provider-scoped so they cannot leak", () => {
    const rules = ERROR_RULES.filter((r) => r.text === "request illegal" || r.text === "conversation id missing");
    expect(rules.length).toBe(2);
    for (const r of rules) expect(r.provider).toBe("codebuddy-intl");
  });
});
