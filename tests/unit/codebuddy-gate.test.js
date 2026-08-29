/**
 * CodeBuddy shared honest gate — business-envelope classification, the three
 * deceptive-200 shapes (JSON body, first-frame SSE, mid-stream SSE), the
 * sanitize layer, the per-credential circuit breaker, and the one-shot token
 * refresh (reference trefeon/codebuffy errors.ts / openai.ts / sanitize.ts /
 * breaker.ts / refresh.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CODEBUDDY_BUSINESS_CODE_HTTP,
  CODEBUDDY_RETRYABLE_CODES,
  businessCodeToHttpStatus,
  businessCodeLabel,
  classifyBusinessEnvelope,
  wrapCodeBuddyStream,
  sanitizeCodeBuddySystemText,
  breakerTryAdmit,
  breakerRecordFailure,
  breakerRecordSuccess,
  refreshCodeBuddyToken,
  __test__,
} from "../../open-sse/shared/codebuddy/gate.js";
import { SSE_DONE } from "../../open-sse/utils/sseConstants.js";

const jsonResponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const sseResponse = (frames, status = 200) =>
  new Response(
    frames.map((f) => (typeof f === "string" ? f : `data: ${JSON.stringify(f)}\n\n`)).join(""),
    { status, headers: { "Content-Type": "text/event-stream" } },
  );

const chunk = (content) => ({ choices: [{ index: 0, delta: { content } }] });

beforeEach(() => {
  __test__.resetBreakers();
});

describe("business-code taxonomy", () => {
  it("maps the four reference codes to their honest statuses", () => {
    expect(CODEBUDDY_BUSINESS_CODE_HTTP[11101]).toBe(400);
    expect(CODEBUDDY_BUSINESS_CODE_HTTP[11128]).toBe(400);
    expect(CODEBUDDY_BUSINESS_CODE_HTTP[11140]).toBe(403);
    expect(CODEBUDDY_BUSINESS_CODE_HTTP[14018]).toBe(429);
  });

  it("businessCodeToHttpStatus: unknown → 502, real statuses pass through", () => {
    expect(businessCodeToHttpStatus(99999)).toBe(502);
    expect(businessCodeToHttpStatus(503)).toBe(503);
    expect(businessCodeToHttpStatus(11128)).toBe(400);
  });

  it("labels carry the reference names", () => {
    expect(businessCodeLabel(11101)).toBe("missing-system");
    expect(businessCodeLabel(11128)).toBe("moderation");
    expect(businessCodeLabel(11140)).toBe("banned");
    expect(businessCodeLabel(14018)).toBe("quota");
  });

  it("the retryable set matches errors.ts", () => {
    for (const c of [401, 403, 429, 500, 502, 503, 504, 11140, 14018]) {
      expect(CODEBUDDY_RETRYABLE_CODES.has(c)).toBe(true);
    }
    expect(CODEBUDDY_RETRYABLE_CODES.has(11101)).toBe(false);
    expect(CODEBUDDY_RETRYABLE_CODES.has(11128)).toBe(false);
  });
});

describe("classifyBusinessEnvelope", () => {
  it("returns null for code 0 / missing / non-objects", () => {
    expect(classifyBusinessEnvelope({ code: 0, msg: "ok" })).toBeNull();
    expect(classifyBusinessEnvelope({ code: "0" })).toBeNull();
    expect(classifyBusinessEnvelope({ choices: [] })).toBeNull();
    expect(classifyBusinessEnvelope(null)).toBeNull();
    expect(classifyBusinessEnvelope([1, 2])).toBeNull();
  });

  it("extracts {code, msg} from non-zero envelopes — msg or message", () => {
    expect(classifyBusinessEnvelope({ code: 11128, msg: "no" })).toEqual({ code: 11128, msg: "no" });
    expect(classifyBusinessEnvelope({ code: 14018, message: "quota" })).toEqual({ code: 14018, msg: "quota" });
    expect(classifyBusinessEnvelope({ code: 500 })).toEqual({ code: 500, msg: null });
  });
});

describe("wrapCodeBuddyStream — shape 1 (200 + JSON envelope)", () => {
  it("maps a quota envelope to an honest 429", async () => {
    const wrapped = await wrapCodeBuddyStream(jsonResponse({ code: 14018, msg: "quota exhausted" }), "glm-5.2");
    expect(wrapped.status).toBe(429);
    const body = await wrapped.json();
    expect(body.error.type).toBe("rate_limit_error");
    expect(body.error.message).toContain("14018");
    expect(body.error.message).toContain("quota");
  });

  it("maps a banned envelope to an honest 403", async () => {
    const wrapped = await wrapCodeBuddyStream(jsonResponse({ code: 11140, msg: "banned" }), "glm-5.2");
    expect(wrapped.status).toBe(403);
  });

  it("unwraps a code-0 envelope hiding a choices chunk into SSE", async () => {
    const hidden = { ...chunk("hidden answer"), model: "glm-5.2" };
    const wrapped = await wrapCodeBuddyStream(jsonResponse({ code: 0, data: hidden }), "glm-5.2");
    expect(wrapped.status).toBe(200);
    expect(wrapped.headers.get("content-type")).toContain("text/event-stream");
    const text = await wrapped.text();
    expect(text).toContain("hidden answer");
    expect(text).toContain(SSE_DONE);
  });

  it("fails honestly on an unexpected JSON shape (no envelope, no choices)", async () => {
    const wrapped = await wrapCodeBuddyStream(jsonResponse({ hello: "world" }), "glm-5.2");
    expect(wrapped.status).toBe(502);
    const body = await wrapped.json();
    expect(body.error.code).toBe("unexpected_upstream_shape");
  });

  it("fails honestly on unparseable JSON", async () => {
    const wrapped = await wrapCodeBuddyStream(
      new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } }),
      "glm-5.2",
    );
    expect(wrapped.status).toBe(502);
  });
});

describe("wrapCodeBuddyStream — shape 2 (first SSE frame envelope)", () => {
  it("a first-frame moderation envelope becomes an honest 400 — nothing streams", async () => {
    const wrapped = await wrapCodeBuddyStream(
      sseResponse([{ code: 11128, msg: "Illegal API invocation from an unapproved channel" }]),
      "glm-5.2",
    );
    expect(wrapped.status).toBe(400);
    const body = await wrapped.json();
    expect(body.error.message).toContain("11128");
    expect(body.error.message).toContain("moderation");
  });

  it("a first-frame banned envelope becomes an honest 403", async () => {
    const wrapped = await wrapCodeBuddyStream(sseResponse([{ code: 11140, msg: "banned" }]), "glm-5.2");
    expect(wrapped.status).toBe(403);
  });
});

describe("wrapCodeBuddyStream — shape 3 (mid-stream envelope)", () => {
  it("degrades gracefully: earlier content preserved, visible error chunk, clean DONE", async () => {
    const wrapped = await wrapCodeBuddyStream(
      sseResponse([chunk("Hello "), { code: 11128, msg: "Illegal API invocation" }, chunk("never seen")]),
      "glm-5.2",
    );
    expect(wrapped.status).toBe(200); // content already flowed — no fallback can reclaim
    const text = await wrapped.text();
    expect(text).toContain("Hello ");                       // earlier content survives
    expect(text).toContain("[codebuddy error 400");          // visible, honest marker
    expect(text).toContain(SSE_DONE);                        // clean terminator
    expect(text).not.toContain("never seen");                // nothing flows after the envelope
  });
});

describe("wrapCodeBuddyStream — passthrough", () => {
  it("a clean stream passes through with every chunk + DONE intact", async () => {
    const wrapped = await wrapCodeBuddyStream(sseResponse([chunk("one"), chunk("two"), "data: [DONE]\n\n"]), "glm-5.2");
    expect(wrapped.status).toBe(200);
    const text = await wrapped.text();
    expect(text).toContain("one");
    expect(text).toContain("two");
    expect(text).toContain(SSE_DONE);
  });

  it("non-ok and bodyless responses pass through untouched", async () => {
    const notOk = jsonResponse({ error: "x" }, 500);
    expect(await wrapCodeBuddyStream(notOk, "glm-5.2")).toBe(notOk);
    const bodyless = new Response(null, { status: 204 });
    expect(await wrapCodeBuddyStream(bodyless, "glm-5.2")).toBe(bodyless);
  });
});

describe("sanitizeCodeBuddySystemText", () => {
  it("substitutes competitor-brand signals", () => {
    const out = sanitizeCodeBuddySystemText(
      "You are Claude Code, Anthropic's official CLI running claude-code on sonnet.",
    );
    expect(out).not.toMatch(/claude/i);
    expect(out).not.toMatch(/anthropic/i);
    expect(out).not.toMatch(/sonnet/i);
    expect(out).toContain("AgentCLI");
    expect(out).toContain("the provider");
    expect(out).toContain("mid-tier model");
  });

  it("drops billing-header lines and rewrites cc_* markers to cli", () => {
    const out = sanitizeCodeBuddySystemText(
      "head\nx-vertex-anthropic-billing-header: abc123\ncc_version=1.0.30 cc_entrypoint=vscode\ntail",
    );
    expect(out).not.toContain("billing-header");
    expect(out).not.toContain("cc_version");
    expect(out).toContain("cli");
    expect(out).toContain("head");
    expect(out).toContain("tail");
  });

  it("drops the git environment block lines", () => {
    const out = sanitizeCodeBuddySystemText(
      "env:\nCurrent branch: main\nMain branch (you will usually use this for PRs): master\nGit user: navis\nGit email: x@y.z\nrest",
    );
    expect(out).not.toContain("Current branch");
    expect(out).not.toContain("Git user");
    expect(out).toContain("rest");
  });

  it("collapses 3+ newlines and survives non-strings", () => {
    expect(sanitizeCodeBuddySystemText("a\n\n\n\nb")).toBe("a\n\nb");
    expect(sanitizeCodeBuddySystemText("")).toBe("");
    expect(sanitizeCodeBuddySystemText(null)).toBe(null);
  });
});

describe("circuit breaker", () => {
  it("admits freely below the threshold, opens at 5 consecutive failures", () => {
    const key = "conn-cb";
    expect(breakerTryAdmit(key)).toBe(true);
    for (let i = 0; i < 4; i++) {
      breakerRecordFailure(key);
      expect(breakerTryAdmit(key)).toBe(true);
      breakerRecordSuccess(key); // reset between probes for the sub-threshold check
    }
    // 5 terminal failures in a row → open.
    for (let i = 0; i < 5; i++) breakerRecordFailure(key);
    // The window runs: exactly ONE half-open probe passes.
    expect(breakerTryAdmit(key)).toBe(true);
    expect(breakerTryAdmit(key)).toBe(false);
    expect(breakerTryAdmit(key)).toBe(false);
  });

  it("a successful probe closes the breaker", () => {
    const key = "conn-cb2";
    for (let i = 0; i < 5; i++) breakerRecordFailure(key);
    expect(breakerTryAdmit(key)).toBe(true); // the probe
    breakerRecordSuccess(key);                // the probe heals
    expect(breakerTryAdmit(key)).toBe(true);  // fully closed
    expect(breakerTryAdmit(key)).toBe(true);
  });

  it("re-admits after the reset window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      const key = "conn-cb3";
      for (let i = 0; i < 5; i++) breakerRecordFailure(key);
      expect(breakerTryAdmit(key)).toBe(true);  // in-window probe
      expect(breakerTryAdmit(key)).toBe(false); // window still running
      vi.advanceTimersByTime(__test__.BREAKER_RESET_MS + 1);
      expect(breakerTryAdmit(key)).toBe(true);  // window elapsed — recovered
    } finally {
      vi.useRealTimers();
    }
  });

  it("breakers are per-credential (keyed by connectionId)", () => {
    for (let i = 0; i < 5; i++) breakerRecordFailure("conn-a");
    expect(breakerTryAdmit("conn-a")).toBe(true); // a's probe
    expect(breakerTryAdmit("conn-a")).toBe(false);
    expect(breakerTryAdmit("conn-b")).toBe(true); // b untouched
  });
});

describe("refreshCodeBuddyToken", () => {
  const baseCreds = () => ({
    accessToken: "old-at",
    refreshToken: "old-rt",
    providerSpecificData: {},
  });

  it("posts the refresh wire with Authorization + X-Refresh-Token + plugin source", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ code: 0, data: { accessToken: "new-at", refreshToken: "new-rt", expiresIn: 3600 } }));
    const out = await refreshCodeBuddyToken(baseCreds(), {
      refreshUrl: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
      userAgent: "CLI/2.63.2 CodeBuddy/2.63.2",
      fetchFn,
    });
    expect(out).toMatchObject({ accessToken: "new-at", refreshToken: "new-rt" });
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain("/v2/plugin/auth/token/refresh");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer old-at");
    expect(opts.headers["X-Refresh-Token"]).toBe("old-rt");
    expect(opts.headers["X-Auth-Refresh-Source"]).toBe("plugin");
    expect(opts.headers["User-Agent"]).toBe("CLI/2.63.2 CodeBuddy/2.63.2");
  });

  it("is one-shot — a second call within 60s returns null without fetching", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ code: 0, data: { accessToken: "new-at" } }));
    const creds = baseCreds();
    await refreshCodeBuddyToken(creds, { refreshUrl: "https://x/r", fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const second = await refreshCodeBuddyToken(creds, { refreshUrl: "https://x/r", fetchFn });
    expect(second).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns null on non-ok responses and business-error envelopes", async () => {
    const notOk = vi.fn(async () => jsonResponse({ error: "denied" }, 401));
    expect(await refreshCodeBuddyToken(baseCreds(), { refreshUrl: "https://x/r", fetchFn: notOk })).toBeNull();
    const bizErr = vi.fn(async () => jsonResponse({ code: 11140, msg: "banned" }));
    expect(await refreshCodeBuddyToken(baseCreds(), { refreshUrl: "https://x/r", fetchFn: bizErr })).toBeNull();
  });

  it("returns null without fetching when tokens or url are missing", async () => {
    const fetchFn = vi.fn();
    expect(await refreshCodeBuddyToken({ accessToken: "a" }, { refreshUrl: "https://x/r", fetchFn })).toBeNull();
    expect(await refreshCodeBuddyToken(baseCreds(), { fetchFn })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("accepts snake_case token fields and projects relative expiry", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: { access_token: "at2", refresh_token: "rt2", expires_in: 7200 } }));
    const out = await refreshCodeBuddyToken(baseCreds(), { refreshUrl: "https://x/r", fetchFn });
    expect(out.accessToken).toBe("at2");
    expect(out.refreshToken).toBe("rt2");
    expect(out.expiresIn).toBeGreaterThan(7190);
    expect(out.expiresIn).toBeLessThanOrEqual(7200);
  });
});
