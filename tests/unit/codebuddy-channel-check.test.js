// The channel-verification law, proven at the boundary.
//
// Carried from the reference gateway (codebuddy2api, app/upstream_compat.py), where
// the rule exists because the rejection "looks like a request fault": HTTP 400 with
// business code 11128, which the generic classifier would never cool down. These
// assertions pin all three properties that make the rule safe — both halves of the
// signal, one retry only, and no fallback for any other path.
import { describe, expect, it } from "vitest";
import {
  hasChannelCode,
  isChannelCheckError,
  channelFallbackUrl,
  shouldChannelFallback,
} from "../../open-sse/shared/codebuddy/channelCheck.js";

const CODE = `{"code":11128,"msg":"illegal api invocation from an unapproved channel"}`;

describe("the code half", () => {
  it("recognises 11128 in a plain envelope", () => {
    expect(hasChannelCode(CODE)).toBe(true);
  });

  it("recognises 11-128, the hyphenated serialization", () => {
    expect(hasChannelCode('{"code":"11-128","msg":"x"}')).toBe(true);
  });

  it("recognises the code inside an embedded, escaped JSON string", () => {
    expect(hasChannelCode('{"error":"{\\"code\\":\\"11128\\"}"}')).toBe(true);
  });

  it("does not match a longer number that merely starts the same", () => {
    expect(hasChannelCode('{"code":111280}')).toBe(false);
  });

  it("is inert on junk", () => {
    expect(hasChannelCode("")).toBe(false);
    expect(hasChannelCode(null)).toBe(false);
    expect(hasChannelCode(42)).toBe(false);
  });
});

describe("recognition requires BOTH halves", () => {
  it("accepts code + English wording", () => {
    expect(isChannelCheckError(CODE)).toBe(true);
  });

  it("accepts code + the Chinese wording", () => {
    expect(isChannelCheckError('{"code":11128,"msg":"渠道校验失败"}')).toBe(true);
  });

  it("refuses a bare code with no explanatory text", () => {
    expect(isChannelCheckError('{"code":11128}')).toBe(false);
  });

  it("refuses the wording with no code", () => {
    expect(isChannelCheckError("illegal api invocation from an unapproved channel")).toBe(false);
  });

  it("reads bytes as well as text", () => {
    expect(isChannelCheckError(new TextEncoder().encode(CODE))).toBe(true);
  });
});

describe("the console door", () => {
  it("maps the primary chat endpoint to its console twin", () => {
    expect(channelFallbackUrl("https://www.codebuddy.ai/v2/chat/completions"))
      .toBe("https://www.codebuddy.ai/console/chat/completions");
  });

  it("preserves the host for the other shore", () => {
    expect(channelFallbackUrl("https://www.codebuddy.cn/v2/chat/completions"))
      .toBe("https://www.codebuddy.cn/console/chat/completions");
  });

  it("offers no door for any other path", () => {
    for (const url of [
      "https://www.codebuddy.ai/console/chat/completions",
      "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
      "https://www.codebuddy.ai/",
      "not a url",
    ]) {
      expect(channelFallbackUrl(url)).toBe(null);
    }
  });
});

describe("exactly one retry, and only for a confirmed rejection", () => {
  const fallback = "https://www.codebuddy.ai/console/chat/completions";

  it("retries a confirmed 400 channel rejection", () => {
    expect(shouldChannelFallback(fallback, 400, CODE)).toBe(true);
  });

  it("refuses when no console door exists", () => {
    expect(shouldChannelFallback(null, 400, CODE)).toBe(false);
  });

  it("refuses any status other than 400", () => {
    for (const status of [401, 403, 429, 500]) {
      expect(shouldChannelFallback(fallback, status, CODE)).toBe(false);
    }
  });

  it("refuses an ordinary 400 that merely looks similar", () => {
    expect(shouldChannelFallback(fallback, 400, '{"code":400,"msg":"request illegal"}')).toBe(false);
  });
});
