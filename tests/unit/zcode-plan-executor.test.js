// M5 — zcode-plan executor. Verdict matrix, quota 429 family, exact header set,
// the 131072 max_tokens clamp, the retry ladder, shouldRetry, and parseError code.
//
// The header-set count is pinned at 23/22: if a new header lands on purpose, the
// count in buildHeaders() and this test must move together — that pairing is the
// guard, not an accident.
import { describe, it, expect } from "vitest";
import { v5 as uuidv5 } from "uuid";
import ZcodePlanExecutor, {
  isZcodeLoadVerdict,
  isQuotaFamily429,
  isZcodeAdmissionLimit,
} from "../../open-sse/executors/zcode-plan.js";
import { defaultZcodeProfile, resolveZcodeProfile } from "../../open-sse/services/zcodeProfile.js";
import zcodeSystemBlocks from "../../open-sse/services/zcode-system-blocks.json";

// Mirrors ZCODE_SESSION_NS inside the executor — the session id is a uuidv5 of the
// device mid under this namespace; the assertion below is the derivation.
const NS = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UA = "ZCode/3.16.3 ai-sdk/provider-utils/4.0.27 runtime/node.js/24";
const BETA_DEFAULT = "mid-conversation-system-2026-04-07";

const DEVICE_MID = "11111111-2222-3333-4444-555555555555";
const JWT = "eyJhbGciOiJIUzI1NiJ9.payload.sig";

function creds(overrides = {}) {
  return {
    accessToken: JWT,
    providerSpecificData: { deviceMid: DEVICE_MID },
    ...overrides,
  };
}

// A fetch-like error response: headers.get by lowercase key, clone().text() body.
function res(status, headers = {}, body = null) {
  const text = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    clone: () => ({ text: async () => text }),
  };
}

describe("zcode-plan executor — load verdict matrix", () => {
  it("529 is always a load verdict, whatever the body", () => {
    expect(isZcodeLoadVerdict(529, "")).toBe(true);
    expect(isZcodeLoadVerdict(529, "no json at all")).toBe(true);
  });

  it("405 carrying 3007 is a load verdict", () => {
    expect(isZcodeLoadVerdict(405, '{"code":3007,"msg":"busy"}')).toBe(true);
  });

  it("429 carrying 3012 is a load verdict", () => {
    expect(isZcodeLoadVerdict(429, '{"code":3012}')).toBe(true);
  });

  it("a plain 429 (no load code) is not a load verdict", () => {
    expect(isZcodeLoadVerdict(429, "")).toBe(false);
    expect(isZcodeLoadVerdict(429, "{}")).toBe(false);
  });

  it("200 is never a load verdict", () => {
    expect(isZcodeLoadVerdict(200, '{"code":3007}')).toBe(false);
  });

  it("405 carrying 1005 is not a load verdict", () => {
    expect(isZcodeLoadVerdict(405, '{"code":1005}')).toBe(false);
  });

  it("a truncated body head ending in '30' yields no code → false", () => {
    expect(isZcodeLoadVerdict(405, '{"code":30')).toBe(false);
  });

  it("code may be quoted and may sit after whitespace", () => {
    expect(isZcodeLoadVerdict(503, '{"code": "3009"}')).toBe(true);
    expect(isZcodeLoadVerdict(429, '{ "code" :  3010 }')).toBe(true);
  });

  it("handles non-string / empty body heads fail-safe", () => {
    expect(isZcodeLoadVerdict(405, undefined)).toBe(false);
    expect(isZcodeLoadVerdict(405, null)).toBe(false);
    expect(isZcodeLoadVerdict(405, { code: 3007 })).toBe(false);
  });
});

describe("zcode-plan executor — quota 429 family", () => {
  it("429 carrying 1318 is quota family", () => {
    expect(isQuotaFamily429(429, '{"code":1318}')).toBe(true);
  });

  it("429 carrying 3012 is NOT quota family (that is the load lane)", () => {
    expect(isQuotaFamily429(429, '{"code":3012}')).toBe(false);
  });

  it("quota codes only count on a 429 — a 503 carrying 1318 is not the family", () => {
    expect(isQuotaFamily429(503, '{"code":1318}')).toBe(false);
  });

  it("walking every quota code", () => {
    for (const code of [1113, 1308, 1309, 1310, 1311, 1313, 1316, 1317, 1318, 1319, 1320, 1321]) {
      expect(isQuotaFamily429(429, `{"code":${code}}`)).toBe(true);
    }
  });
});

describe("zcode-plan executor — buildHeaders", () => {
  const exec = new ZcodePlanExecutor();

  it("stream carries 23 keys; non-stream 22 (Accept is the difference)", () => {
    const stream = exec.buildHeaders(creds(), true);
    const plain = exec.buildHeaders(creds(), false);
    expect(Object.keys(stream)).toHaveLength(23);
    expect(Object.keys(plain)).toHaveLength(22);
    expect(stream.Accept).toBe("text/event-stream");
    expect(plain).not.toHaveProperty("Accept");
  });

  it("carries the exact User-Agent", () => {
    expect(exec.buildHeaders(creds())["User-Agent"]).toBe(UA);
  });

  it("both Authorization Bearer and x-api-key carry the access token", () => {
    const h = exec.buildHeaders(creds());
    expect(h.Authorization).toBe(`Bearer ${JWT}`);
    expect(h["x-api-key"]).toBe(JWT);
  });

  it("falls back to anthropic-beta default when no raw headers exist", () => {
    expect(exec.buildHeaders(creds())["anthropic-beta"]).toBe(BETA_DEFAULT);
  });

  it("reads inbound anthropic-beta case-insensitively from a plain rawHeaders object", () => {
    const h = exec.buildHeaders(creds({ rawHeaders: { "Anthropic-Beta": "x" } }));
    expect(h["anthropic-beta"]).toBe("x");
  });

  it("reads inbound anthropic-beta through a header-map get()", () => {
    const rawHeaders = { get: (k) => (String(k).toLowerCase() === "anthropic-beta" ? "map-beta" : null) };
    expect(exec.buildHeaders(creds({ rawHeaders }))["anthropic-beta"]).toBe("map-beta");
  });

  it("joins array-valued inbound betas", () => {
    const h = exec.buildHeaders(creds({ rawHeaders: { "anthropic-beta": ["a", "b"] } }));
    expect(h["anthropic-beta"]).toBe("a, b");
  });

  it("x-session-id is the stable uuidv5 of deviceMid; x-request-id is fresh per call", () => {
    const a = exec.buildHeaders(creds());
    const b = exec.buildHeaders(creds());
    const want = uuidv5(DEVICE_MID, NS);
    expect(a["x-session-id"]).toBe(want);
    expect(b["x-session-id"]).toBe(want);
    expect(a["x-request-id"]).not.toBe(b["x-request-id"]);
    expect(a["x-query-id"]).not.toBe(b["x-query-id"]);
    expect(a["x-zcode-trace-id"]).not.toBe(b["x-zcode-trace-id"]);
  });

  it("different device mids derive different session ids", () => {
    const a = exec.buildHeaders(creds());
    const b = exec.buildHeaders(creds({ providerSpecificData: { deviceMid: "other-device" } }));
    expect(a["x-session-id"]).not.toBe(b["x-session-id"]);
  });

  // G9 — with no zcodeProfile on credentials the four identity slots carry the
  // baked defaults, byte-for-byte as the literals did before.
  it("bare credentials (no zcodeProfile) → the four baked identity values", () => {
    for (const credentials of [creds(), creds({ providerSpecificData: {} })]) {
      const h = exec.buildHeaders(credentials);
      expect(h["X-Platform"]).toBe("darwin-x64");
      expect(h["X-Os-Version"]).toBe("21.6.0");
      expect(h["X-Client-Language"]).toBe("en-US");
      expect(h["X-Client-Timezone"]).toBe("Europe/Bucharest");
      expect(Object.keys(h)).toHaveLength(23);
    }
  });

  it("credential zcodeProfile overrides only the slots it names", () => {
    const h = exec.buildHeaders(creds({
      providerSpecificData: { deviceMid: DEVICE_MID, zcodeProfile: { osVersion: "24.5.0", timezone: "UTC" } },
    }));
    expect(h["X-Os-Version"]).toBe("24.5.0");
    expect(h["X-Client-Timezone"]).toBe("UTC");
    expect(h["X-Platform"]).toBe("darwin-x64");
    expect(h["X-Client-Language"]).toBe("en-US");
    expect(Object.keys(h)).toHaveLength(23);
  });
});

describe("zcode-profile resolver", () => {
  it("defaults are the four baked identity values", () => {
    expect(defaultZcodeProfile()).toEqual({
      platform: "darwin-x64", osVersion: "21.6.0", language: "en-US", timezone: "Europe/Bucharest",
    });
  });

  it("missing / malformed providerSpecificData yields the defaults", () => {
    for (const psd of [undefined, null, {}, { zcodeProfile: null }, { zcodeProfile: "x" }, { zcodeProfile: [1] }]) {
      expect(resolveZcodeProfile(psd)).toEqual(defaultZcodeProfile());
    }
  });

  it("valid overrides layer; non-string overrides are skipped", () => {
    expect(resolveZcodeProfile({ zcodeProfile: { platform: "linux-x64", osVersion: {}, language: "", timezone: 7 } }))
      .toEqual({ platform: "linux-x64", osVersion: "21.6.0", language: "en-US", timezone: "Europe/Bucharest" });
  });

  it("does not mutate its input", () => {
    const psd = { zcodeProfile: { platform: "linux-x64" } };
    resolveZcodeProfile(psd);
    expect(psd).toEqual({ zcodeProfile: { platform: "linux-x64" } });
  });
});

describe("zcode-plan executor — max_tokens clamp", () => {
  const exec = new ZcodePlanExecutor();

  it("clamps 200000 down to 131072", () => {
    expect(exec.transformRequest("m", { max_tokens: 200000, messages: [] }, true, creds()).max_tokens).toBe(131072);
  });

  it("leaves 131072 untouched", () => {
    expect(exec.transformRequest("m", { max_tokens: 131072 }, true, creds()).max_tokens).toBe(131072);
  });

  it("leaves smaller values untouched", () => {
    expect(exec.transformRequest("m", { max_tokens: 4096 }, true, creds()).max_tokens).toBe(4096);
  });

  it("shallow-clones: the input body is not mutated", () => {
    const body = { max_tokens: 200000, model: "glm-5.3" };
    const out = exec.transformRequest("m", body, true, creds());
    expect(out).not.toBe(body);
    expect(body.max_tokens).toBe(200000);
    expect(out.model).toBe("glm-5.3");
  });

  it("passes a non-object body through untouched", () => {
    expect(exec.transformRequest("m", "raw", true, creds())).toBe("raw");
    expect(exec.transformRequest("m", null, true, creds())).toBe(null);
  });
});

// G8 — the three official-client identity blocks ride ahead of the caller's
// system content, without cache_control, exactly once per body.
describe("zcode-plan executor — identity prepend (G8)", () => {
  const exec = new ZcodePlanExecutor();
  const blockTexts = zcodeSystemBlocks.map((b) => b.text);
  const sentinel = blockTexts[0].slice(0, 40);

  it("array system: three text blocks prepended, cache_control stripped", () => {
    const own = { type: "text", text: "User system", cache_control: { type: "ephemeral" } };
    const out = exec.transformRequest("m", { system: [own] }, true, creds());
    expect(out.system).toHaveLength(4);
    expect(out.system.slice(0, 3)).toEqual(blockTexts.map((text) => ({ type: "text", text })));
    for (const b of out.system.slice(0, 3)) expect(b).not.toHaveProperty("cache_control");
    // The caller's own entry keeps its cache_control, and is the same object.
    expect(out.system[3]).toBe(own);
    expect(out.system[3].cache_control).toEqual({ type: "ephemeral" });
  });

  it("string system: concatenated block text + blank line before it, still a string", () => {
    const out = exec.transformRequest("m", { system: "MY SYSTEM" }, true, creds());
    expect(typeof out.system).toBe("string");
    expect(out.system).toBe(`${blockTexts.join("\n\n")}\n\nMY SYSTEM`);
    expect(out.system.endsWith("MY SYSTEM")).toBe(true);
    expect(out.system).toContain(sentinel);
  });

  it("idempotent: transformRequest twice → identical system (array and string)", () => {
    const arrayBody = { system: [{ type: "text", text: "own" }] };
    const once = exec.transformRequest("m", arrayBody, true, creds());
    const twice = exec.transformRequest("m", once, true, creds());
    expect(twice.system).toEqual(once.system);
    expect(twice.system).toHaveLength(4);

    const strBody = { system: "own" };
    const s1 = exec.transformRequest("m", strBody, true, creds());
    const s2 = exec.transformRequest("m", s1, true, creds());
    expect(s2.system).toBe(s1.system);
    expect(s2.system.split(sentinel)).toHaveLength(2);
  });

  it("body with no system is left without one", () => {
    const out = exec.transformRequest("m", { max_tokens: 10 }, true, creds());
    expect(out).not.toHaveProperty("system");
  });

  it("clamp and prepend coexist; the caller's body is not mutated", () => {
    const body = { max_tokens: 200000, system: "s" };
    const out = exec.transformRequest("m", body, true, creds());
    expect(out.max_tokens).toBe(131072);
    expect(out.system).not.toBe("s");
    expect(body.system).toBe("s");
  });

  it("never fatal: a hostile system object ships the un-prepended clone", () => {
    // A plain object whose only enumerable content throws on access.
    const hostile = {};
    Object.defineProperty(hostile, "text", { enumerable: true, get() { throw new Error("boom"); } });
    const out = exec.transformRequest("m", { system: hostile, max_tokens: 200000 }, true, creds());
    expect(out.system).toBe(hostile);
    expect(out.max_tokens).toBe(131072);
    // The G14 stamp still lands after the G8 failure.
    expect(typeof out.metadata.user_id).toBe("string");
  });
});

// G14 — metadata.user_id carries the client's JSON meta blob.
describe("zcode-plan executor — metadata.user_id (G14)", () => {
  const exec = new ZcodePlanExecutor();

  it("stamps device_id, empty account_uuid, and the x-session-id derivation", () => {
    const out = exec.transformRequest("m", { messages: [] }, true, creds());
    expect(JSON.parse(out.metadata.user_id)).toEqual({
      device_id: DEVICE_MID,
      account_uuid: "",
      session_id: uuidv5(DEVICE_MID, NS),
    });
    expect(JSON.parse(out.metadata.user_id).session_id).toBe(exec.buildHeaders(creds())["x-session-id"]);
  });

  it("empty deviceMid derives from 'anonymous' and stamps an empty device_id", () => {
    const out = exec.transformRequest("m", { messages: [] }, true, { accessToken: JWT });
    expect(JSON.parse(out.metadata.user_id)).toEqual({
      device_id: "",
      account_uuid: "",
      session_id: uuidv5("anonymous", NS),
    });
  });

  it("keeps other metadata keys and does not mutate the input", () => {
    const body = { metadata: { trace: "t" } };
    const out = exec.transformRequest("m", body, true, creds());
    expect(out.metadata.trace).toBe("t");
    expect(typeof out.metadata.user_id).toBe("string");
    expect(body.metadata).toEqual({ trace: "t" });
  });

  it("an inbound user_id is left untouched", () => {
    const body = { metadata: { user_id: "caller-owned" } };
    const out = exec.transformRequest("m", body, true, creds());
    expect(out.metadata.user_id).toBe("caller-owned");
  });
});

describe("zcode-plan executor — computeRetryDelay ladder", () => {
  const exec = new ZcodePlanExecutor();

  it("529 on attempt 1 → 1000ms", async () => {
    expect(await exec.computeRetryDelay(res(529), 1)).toBe(1000);
  });

  it("529 on attempt 6 → false (ladder exhausted)", async () => {
    expect(await exec.computeRetryDelay(res(529), 6)).toBe(false);
  });

  it("quota-family 429 is vetoed outright", async () => {
    expect(await exec.computeRetryDelay(res(429, {}, { code: 1318 }), 1)).toBe(false);
  });

  it("429 with Retry-After 7 → 7000ms", async () => {
    expect(await exec.computeRetryDelay(res(429, { "retry-after": "7" }), 1)).toBe(7000);
  });

  it("429 with a huge Retry-After is capped at 120000ms", async () => {
    expect(await exec.computeRetryDelay(res(429, { "retry-after": "9999" }), 1)).toBe(120000);
  });

  it("plain 429 on attempt 3 → 4000ms (exponential)", async () => {
    expect(await exec.computeRetryDelay(res(429), 3)).toBe(4000);
  });

  it("plain 429 exponential is capped at 30000ms", async () => {
    const plain = (a) => exec.computeRetryDelay(res(429), a);
    const ladder = [];
    for (let a = 1; a <= 5; a += 1) ladder.push(await plain(a));
    expect(ladder).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(await plain(6)).toBe(false);
  });

  // G1 — 429 + 3010 is the admission limit: two short re-dials [1000, 2000],
  // then veto so the chain fails over. 3010 is not a quota code.
  it("429 with 3010 → [1000, 2000] then veto", async () => {
    const admission = (a) => exec.computeRetryDelay(res(429, {}, { code: 3010 }), a);
    expect(await admission(1)).toBe(1000);
    expect(await admission(2)).toBe(2000);
    expect(await admission(3)).toBe(false);
    expect(await admission(6)).toBe(false);
  });

  it("429 with 3010 ignores Retry-After — the cadence is fixed", async () => {
    expect(await exec.computeRetryDelay(res(429, { "retry-after": "7" }, { code: 3010 }), 1)).toBe(1000);
  });

  it("3010 is NOT quota family; isZcodeAdmissionLimit names it", () => {
    expect(isQuotaFamily429(429, '{"code":3010}')).toBe(false);
    expect(isZcodeAdmissionLimit(429, '{"code":3010}')).toBe(true);
    expect(isZcodeAdmissionLimit(429, '{"code":3012}')).toBe(false);
    expect(isZcodeAdmissionLimit(503, '{"code":3010}')).toBe(false);
    expect(isZcodeAdmissionLimit(429, "")).toBe(false);
    expect(ZcodePlanExecutor.isZcodeAdmissionLimit(429, '{"code":3010}')).toBe(true);
  });

  it("503 on attempt 1 → 1000ms", async () => {
    expect(await exec.computeRetryDelay(res(503), 1)).toBe(1000);
  });

  it("503 on attempt 6 → false", async () => {
    expect(await exec.computeRetryDelay(res(503), 6)).toBe(false);
  });

  it("502 and 405 re-dial at 1000ms inside the ladder", async () => {
    expect(await exec.computeRetryDelay(res(502), 2)).toBe(1000);
    expect(await exec.computeRetryDelay(res(405), 2)).toBe(1000);
  });

  it("400 → null (no opinion, fallback decides)", async () => {
    expect(await exec.computeRetryDelay(res(400), 1)).toBe(null);
  });

  it("survives a response whose clone() throws", async () => {
    const broken = { status: 503, headers: { get: () => null }, clone: () => { throw new Error("gone"); } };
    expect(await exec.computeRetryDelay(broken, 1)).toBe(1000);
  });
});

describe("zcode-plan executor — shouldRetry", () => {
  const exec = new ZcodePlanExecutor();

  it("retries 429, 529, 405, 502, 503", () => {
    for (const s of [429, 529, 405, 502, 503]) expect(exec.shouldRetry(s)).toBe(true);
  });

  it("does not retry 200, 400, 401, 403", () => {
    for (const s of [200, 400, 401, 403]) expect(exec.shouldRetry(s)).toBe(false);
  });
});

// G7 — a 500 is a busy origin, not a broken request: re-dial it twice at 1000ms
// on the same dock, then hand the failure to the chain. shouldRetry(500) stays
// false (the retry entry, not the failover switch, is what schedules it).
describe("zcode-plan executor — 500 retried twice, then failover", () => {
  const exec = new ZcodePlanExecutor();

  it("carries a 2-attempt / 1000ms 500 entry", () => {
    expect(exec.config.retry[500]).toEqual({ attempts: 2, delayMs: 1000 });
  });

  it("computeRetryDelay(500) holds at 1000ms for every attempt", async () => {
    expect(await exec.computeRetryDelay(res(500), 1)).toBe(1000);
    expect(await exec.computeRetryDelay(res(500), 2)).toBe(1000);
  });

  it("computeRetryDelay(500) vetoes on attempt 3 — two re-dials, then failover", async () => {
    expect(await exec.computeRetryDelay(res(500), 3)).toBe(false);
    expect(await exec.computeRetryDelay(res(500), 6)).toBe(false);
  });

  it("502 and 503 are trimmed to 2 attempts at 1000ms", () => {
    expect(exec.config.retry[502]).toEqual({ attempts: 2, delayMs: 1000 });
    expect(exec.config.retry[503]).toEqual({ attempts: 2, delayMs: 1000 });
  });

  it("static mirrors agree with the named exports", () => {
    expect(ZcodePlanExecutor.isZcodeLoadVerdict(529, "")).toBe(true);
    expect(ZcodePlanExecutor.isQuotaFamily429(429, '{"code":1318}')).toBe(true);
  });
});

describe("zcode-plan executor — parseError", () => {
  const exec = new ZcodePlanExecutor();

  it("attaches the numeric code from a JSON body", () => {
    const parsed = exec.parseError(res(429), JSON.stringify({ code: 1318, msg: "quota" }));
    expect(parsed.code).toBe(1318);
    expect(parsed.status).toBe(429);
  });

  it("keeps a string code", () => {
    const parsed = exec.parseError(res(405), JSON.stringify({ code: "1005" }));
    expect(parsed.code).toBe("1005");
  });

  it("leaves a non-JSON body to the base reading", () => {
    const parsed = exec.parseError(res(500), "<html>oops</html>");
    expect(parsed.code).toBeUndefined();
    expect(parsed.message).toBe("<html>oops</html>");
  });

  it("does not attach an empty-string code", () => {
    const parsed = exec.parseError(res(500), JSON.stringify({ code: "" }));
    expect(parsed.code).toBeUndefined();
  });
});

describe("zcode-plan executor — construction", () => {
  it("defaults to provider zcode-plan and carries the 429/405/529/503/502 ladder", () => {
    const exec = new ZcodePlanExecutor();
    expect(exec.provider).toBe("zcode-plan");
    expect(exec.config.retry[429].attempts).toBe(5);
    expect(exec.config.retry[529].attempts).toBe(5);
    expect(exec.config.retry[405].attempts).toBe(5);
  });

  it("builds the zcode-plan anthropic messages URL", () => {
    expect(new ZcodePlanExecutor().buildUrl()).toBe(
      "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages",
    );
  });
});
