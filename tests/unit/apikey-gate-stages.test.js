// Test covenant: apikey-gate-stages — the W3 enforcement stages.
// Plan: plans/vela-key-governance.md §3.4 W3. Covers ipStage (CIDR matrix,
// fail-closed), rateStage (sliding 60s window), spendStage (windowed token +
// spend budgets with TTL cache), and their wiring through authorizeApiRequest
// via the trusted x-9r-real-ip header stamped by custom-server.js.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveKey: vi.fn(),
  getApiKeyById: vi.fn(),
  getAdapter: vi.fn(),
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  resolveKey: mocks.resolveKey,
  getApiKeyById: mocks.getApiKeyById,
}));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));

const {
  authorizeApiRequest,
  parseCidr,
  cidrContains,
  extractClientIp,
  resolveClientIp,
  ipStage,
  rateStage,
  spendStage,
  sumKeyUsage,
  localDateKey,
  windowStartDateKey,
  BUDGET_SCOPES,
  GATE_CODES,
} = await import("@/sse/services/keyGate.js");

function req(headers = {}) {
  return { headers: new Headers(headers), url: "http://localhost/v1/chat/completions" };
}

function row(over = {}) {
  return {
    id: "kid" + "0".repeat(29),
    name: "Test Key",
    keyPrefix: "vela-v1-kid0…",
    isActive: 1,
    isInternal: 0,
    allowedModels: null,
    expiresAt: null,
    rateLimitRpm: null,
    tokenBudgetDaily: null,
    spendCapDailyCents: null,
    budgetScope: null,
    ipAllowlist: null,
    ...over,
  };
}

// One usageDaily ledger row. Shape mirrors src/lib/usageDb.js: JSON `data`
// column, byApiKey keyed `${keyId}|${model}|${provider}` with meta.keyId.
function usageRow(dateKey, keyId, { prompt = 0, completion = 0, cost = 0 } = {}) {
  return {
    dateKey,
    data: JSON.stringify({
      byApiKey: {
        [`${keyId}|openai/gpt-4o|openai`]: {
          promptTokens: prompt,
          completionTokens: completion,
          cost,
          meta: { keyId },
        },
      },
    }),
  };
}

// Simulates the SQL WHERE dateKey >= ? — the mock honors the param so window
// boundaries are tested end-to-end, not just the query string.
function ledgerDb(rows) {
  return {
    run: vi.fn(),
    all: vi.fn((_sql, params) => rows.filter((r) => r.dateKey >= params[0])),
  };
}

const SETTINGS = { requireApiKey: true };
const VALID_BEARER = { Authorization: "Bearer vela-v1-test" };

beforeEach(() => {
  vi.clearAllMocks();
  // In-memory stage state lives on global — reset so tests stay independent.
  delete global._velaRateWindows;
  delete global._velaBudgetCache;
  mocks.getAdapter.mockResolvedValue({ run: vi.fn(), all: vi.fn(() => []) });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── CIDR parsing & matching ────────────────────────────────────────────────

describe("parseCidr / cidrContains — the CIDR matrix", () => {
  const matrix = [
    // [cidr, ip, expected]
    ["10.0.0.0/8", "10.1.2.3", true],
    ["10.0.0.0/8", "10.255.255.255", true],
    ["10.0.0.0/8", "11.0.0.1", false],
    ["192.168.1.0/24", "192.168.1.99", true],
    ["192.168.1.0/24", "192.168.2.99", false],
    // Prefix boundary: /25 splits the last octet at 128
    ["192.168.1.0/25", "192.168.1.127", true],
    ["192.168.1.0/25", "192.168.1.128", false],
    // Bare IP = /32 exact match
    ["10.0.0.1", "10.0.0.1", true],
    ["10.0.0.1", "10.0.0.2", false],
    // /0 matches the whole v4 space
    ["0.0.0.0/0", "203.0.113.7", true],
    // v6
    ["2001:db8::/32", "2001:db8::1", true],
    ["2001:db8::/32", "2001:db8:ffff::1", true],
    ["2001:db8::/32", "2001:db9::1", false],
    ["::1/128", "::1", true],
    ["::1/128", "::2", false],
    // IPv4-mapped IPv6 client against a v4 allowlist entry — normalized both sides
    ["192.168.1.0/24", "::ffff:192.168.1.50", true],
    ["192.168.1.0/24", "::ffff:192.168.2.50", false],
    // Family mismatch never matches
    ["10.0.0.0/8", "2001:db8::1", false],
    ["2001:db8::/32", "10.0.0.1", false],
  ];

  for (const [cidr, ip, expected] of matrix) {
    it(`${cidr} ${expected ? "contains" : "rejects"} ${ip}`, () => {
      expect(cidrContains(cidr, ip)).toBe(expected);
    });
  }

  it("accepts a pre-parsed net object", () => {
    const net = parseCidr("10.0.0.0/8");
    expect(cidrContains(net, "10.9.9.9")).toBe(true);
  });

  it("rejects malformed input — parseCidr returns null", () => {
    for (const bad of [null, "", "abc", "1.2.3", "10.0.0.256", "10.0.0.0/33", "::1/129", "1.2.3.4/-1", "1.2.3.4/x", "1::2::3"]) {
      expect(parseCidr(bad), `parseCidr(${JSON.stringify(bad)})`).toBeNull();
    }
  });

  it("strips IPv6 zone suffix and brackets", () => {
    expect(cidrContains("fe80::/10", "fe80::1%eth0")).toBe(true);
    expect(cidrContains("::1/128", "[::1]")).toBe(true);
  });

  it("cidrContains fails closed on garbage on either side", () => {
    expect(cidrContains("not-a-cidr", "10.0.0.1")).toBe(false);
    expect(cidrContains("10.0.0.0/8", "not-an-ip")).toBe(false);
  });
});

// ── ipStage ────────────────────────────────────────────────────────────────

describe("ipStage — allowlist enforcement (fail-closed)", () => {
  it("no allowlist → unrestricted", () => {
    expect(ipStage({ ipAllowlist: null }, {}).ok).toBe(true);
    expect(ipStage({ ipAllowlist: [] }, {}).ok).toBe(true);
  });

  it("allowlist set but client IP unresolvable → fails CLOSED with 403", () => {
    const verdict = ipStage({ ipAllowlist: ["10.0.0.0/8"] }, { clientIp: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(GATE_CODES.IP_NOT_ALLOWED);
    expect(verdict.status).toBe(403);
  });

  it("matching IP passes; non-matching denies with 403", () => {
    const key = { ipAllowlist: ["10.0.0.0/8", "192.168.1.0/24"] };
    expect(ipStage(key, { clientIp: "10.7.7.7" }).ok).toBe(true);
    expect(ipStage(key, { clientIp: "192.168.1.42" }).ok).toBe(true);
    const denied = ipStage(key, { clientIp: "203.0.113.9" });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.IP_NOT_ALLOWED);
    expect(denied.status).toBe(403);
  });

  it("malformed allowlist entries never match (fail-closed per entry)", () => {
    const denied = ipStage({ ipAllowlist: ["garbage"] }, { clientIp: "10.0.0.1" });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.IP_NOT_ALLOWED);
  });
});

// ── rateStage ──────────────────────────────────────────────────────────────

describe("rateStage — sliding 60s window per key", () => {
  it("no rpm set → unrestricted", () => {
    expect(rateStage({ keyId: "a", rateLimitRpm: null }).ok).toBe(true);
    expect(rateStage({ keyId: "a", rateLimitRpm: 0 }).ok).toBe(true);
  });

  it("allows exactly rpm requests, then 429 rate_limited with honest context", () => {
    vi.useFakeTimers();
    const key = { keyId: "ratekey", rateLimitRpm: 3 };
    expect(rateStage(key).ok).toBe(true);
    expect(rateStage(key).ok).toBe(true);
    expect(rateStage(key).ok).toBe(true);
    const denied = rateStage(key);
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.RATE_LIMITED);
    expect(denied.status).toBe(429);
    expect(denied.message).toContain("3 requests per minute");
  });

  it("window slides — capacity returns after stamps age out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const key = { keyId: "slidekey", rateLimitRpm: 1 };
    expect(rateStage(key).ok).toBe(true);
    expect(rateStage(key).ok).toBe(false);
    vi.advanceTimersByTime(61_000); // past the 60s window
    expect(rateStage(key).ok).toBe(true);
  });

  it("windows are isolated per keyId", () => {
    vi.useFakeTimers();
    expect(rateStage({ keyId: "k1", rateLimitRpm: 1 }).ok).toBe(true);
    expect(rateStage({ keyId: "k1", rateLimitRpm: 1 }).ok).toBe(false);
    expect(rateStage({ keyId: "k2", rateLimitRpm: 1 }).ok).toBe(true);
  });

  it("a denied request does not consume a window slot", () => {
    vi.useFakeTimers();
    const key = { keyId: "slotkey", rateLimitRpm: 1 };
    expect(rateStage(key).ok).toBe(true);
    expect(rateStage(key).ok).toBe(false);
    expect(rateStage(key).ok).toBe(false);
    vi.advanceTimersByTime(61_000);
    // Only the first (passing) request aged out — capacity is exactly 1 again
    expect(rateStage(key).ok).toBe(true);
    expect(rateStage(key).ok).toBe(false);
  });
});

// ── budget window math ─────────────────────────────────────────────────────

describe("budget window boundaries (local-date convention)", () => {
  it("BUDGET_SCOPES is the sealed set", () => {
    expect(BUDGET_SCOPES).toEqual(["daily", "weekly", "monthly", "yearly"]);
  });

  it("localDateKey renders zero-padded local YYYY-MM-DD", () => {
    expect(localDateKey(new Date(2024, 0, 5))).toBe("2024-01-05");
    expect(localDateKey(new Date(2024, 11, 31))).toBe("2024-12-31");
  });

  it("windowStartDateKey — daily is today", () => {
    expect(windowStartDateKey("daily", new Date(2024, 0, 3, 23, 59))).toBe("2024-01-03");
  });

  it("windowStartDateKey — weekly starts Monday (ISO)", () => {
    // 2024-01-01 is a Monday; 2024-01-07 is the following Sunday
    expect(windowStartDateKey("weekly", new Date(2024, 0, 1))).toBe("2024-01-01");
    expect(windowStartDateKey("weekly", new Date(2024, 0, 3))).toBe("2024-01-01"); // Wed
    expect(windowStartDateKey("weekly", new Date(2024, 0, 7))).toBe("2024-01-01"); // Sunday → still that week's Monday
    expect(windowStartDateKey("weekly", new Date(2024, 0, 8))).toBe("2024-01-08"); // next Monday
  });

  it("windowStartDateKey — monthly is the 1st, yearly is Jan 1", () => {
    expect(windowStartDateKey("monthly", new Date(2024, 2, 15))).toBe("2024-03-01");
    expect(windowStartDateKey("yearly", new Date(2024, 6, 20))).toBe("2024-01-01");
  });
});

// ── sumKeyUsage ────────────────────────────────────────────────────────────

describe("sumKeyUsage — ledger aggregation", () => {
  it("sums tokens and cents only for the matching keyId", async () => {
    const keyId = "keyA";
    mocks.getAdapter.mockResolvedValue(
      ledgerDb([
        usageRow("2026-08-13", keyId, { prompt: 100, completion: 50, cost: 1.01 }),
        usageRow("2026-08-14", keyId, { prompt: 200, completion: 250, cost: 2 }),
        usageRow("2026-08-14", "otherKey", { prompt: 9999, completion: 9999, cost: 99 }),
      ])
    );
    const { tokens, costCents } = await sumKeyUsage(keyId, "2026-08-13");
    expect(tokens).toBe(600); // 100+50+200+250 — otherKey excluded
    expect(costCents).toBe(301); // round(1.01*100)=101 + 200 (1.01 is exactly representable enough for Math.round)
  });

  it("skips rows with corrupt JSON without throwing", async () => {
    const keyId = "keyB";
    mocks.getAdapter.mockResolvedValue({
      run: vi.fn(),
      all: vi.fn(() => [
        { dateKey: "2026-08-14", data: "{corrupt" },
        usageRow("2026-08-14", keyId, { prompt: 10, completion: 5, cost: 0.1 }),
      ]),
    });
    const { tokens, costCents } = await sumKeyUsage(keyId, "2026-08-14");
    expect(tokens).toBe(15);
    expect(costCents).toBe(10);
  });
});

// ── spendStage ─────────────────────────────────────────────────────────────

describe("spendStage — windowed token budget + spend cap (soft cap)", () => {
  it("no budget and no cap → unrestricted, no ledger read", async () => {
    const db = ledgerDb([]);
    mocks.getAdapter.mockResolvedValue(db);
    const verdict = await spendStage({ keyId: "k", tokenBudgetDaily: null, spendCapDailyCents: null, budgetScope: null });
    expect(verdict.ok).toBe(true);
    expect(db.all).not.toHaveBeenCalled();
  });

  it("usage under the token budget passes; at/over it → 429 budget_exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const keyId = "budgetkey";
    mocks.getAdapter.mockResolvedValue(
      ledgerDb([usageRow("2026-08-14", keyId, { prompt: 600, completion: 300 })])
    );
    const under = await spendStage({ keyId, tokenBudgetDaily: 1000, spendCapDailyCents: null, budgetScope: "daily" });
    expect(under.ok).toBe(true);
    delete global._velaBudgetCache; // fresh read for the next scenario
    mocks.getAdapter.mockResolvedValue(
      ledgerDb([usageRow("2026-08-14", keyId, { prompt: 600, completion: 400 })])
    );
    const at = await spendStage({ keyId, tokenBudgetDaily: 1000, spendCapDailyCents: null, budgetScope: "daily" });
    expect(at.ok).toBe(false);
    expect(at.code).toBe(GATE_CODES.BUDGET_EXCEEDED);
    expect(at.status).toBe(429);
    expect(at.message).toContain("token budget exceeded");
    expect(at.message).toContain("1000 of 1000");
  });

  it("spend cap compares cents — at/over → 429 with dollar context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const keyId = "spendkey";
    mocks.getAdapter.mockResolvedValue(
      ledgerDb([usageRow("2026-08-14", keyId, { cost: 5.0 })])
    );
    const verdict = await spendStage({ keyId, tokenBudgetDaily: null, spendCapDailyCents: 500, budgetScope: "daily" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(GATE_CODES.BUDGET_EXCEEDED);
    expect(verdict.message).toContain("$5.00 of $5.00");
  });

  it("usage outside the window is not counted (weekly scope ignores prior week)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00")); // Friday; window starts Monday 2026-08-10
    const keyId = "weekkey";
    mocks.getAdapter.mockResolvedValue(
      ledgerDb([
        usageRow("2026-08-08", keyId, { prompt: 999999, completion: 0 }), // prior week — must be excluded
        usageRow("2026-08-12", keyId, { prompt: 100, completion: 0 }),
      ])
    );
    const verdict = await spendStage({ keyId, tokenBudgetDaily: 500, spendCapDailyCents: null, budgetScope: "weekly" });
    expect(verdict.ok).toBe(true); // only 100 tokens count, not 999999+100
  });

  it("invalid budgetScope falls back to daily", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const keyId = "fallbackkey";
    const db = ledgerDb([usageRow("2026-08-14", keyId, { prompt: 10 })]);
    mocks.getAdapter.mockResolvedValue(db);
    await spendStage({ keyId, tokenBudgetDaily: 100, spendCapDailyCents: null, budgetScope: "hourly" });
    expect(db.all).toHaveBeenCalledWith(expect.any(String), ["2026-08-14"]); // daily window start
  });

  it("TTL cache — repeated calls within 5s read the ledger once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const keyId = "cachekey";
    const db = ledgerDb([usageRow("2026-08-14", keyId, { prompt: 10 })]);
    mocks.getAdapter.mockResolvedValue(db);
    const key = { keyId, tokenBudgetDaily: 100, spendCapDailyCents: null, budgetScope: "daily" };
    await spendStage(key);
    await spendStage(key);
    await spendStage(key);
    expect(db.all).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_001); // TTL expired → re-read
    await spendStage(key);
    expect(db.all).toHaveBeenCalledTimes(2);
  });
});

// ── extractClientIp ────────────────────────────────────────────────────────

describe("extractClientIp — only the trusted header", () => {
  it("reads x-9r-real-ip; ignores attacker-controlled forwarding headers", () => {
    expect(extractClientIp(req({ "x-9r-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.7");
    expect(extractClientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBeNull();
    expect(extractClientIp(req({}))).toBeNull();
    expect(extractClientIp(null)).toBeNull();
  });
});

describe("resolveClientIp — override → socket header → loopback Host fallback", () => {
  it("explicit override wins over everything", () => {
    expect(resolveClientIp(req({ "x-9r-real-ip": "203.0.113.7", host: "localhost:32060" }), { clientIp: "10.0.0.1" })).toBe("10.0.0.1");
  });

  it("socket-stamped header wins over the Host fallback", () => {
    expect(resolveClientIp(req({ "x-9r-real-ip": "192.168.18.5", host: "localhost:32060" }), { isInternal: true })).toBe("192.168.18.5");
  });

  it("internal key + loopback Host (dev mode, no custom-server) resolves to loopback", () => {
    // The real self-call shapes: pingModelByKind hardcodes 127.0.0.1; browsers
    // use localhost. ([::1]:port is not parsed here — deliberate parity with
    // dashboardGuard.isLocalRequest's documented Host fallback.)
    for (const host of ["localhost:32060", "127.0.0.1:32060", "localhost"]) {
      expect(resolveClientIp(req({ host }), { isInternal: true })).toBe("127.0.0.1");
    }
  });

  it("the Host fallback NEVER applies to external keys — they fail closed", () => {
    expect(resolveClientIp(req({ host: "localhost:32060" }), { isInternal: false })).toBeNull();
    expect(resolveClientIp(req({ host: "localhost:32060" }), {})).toBeNull();
  });

  it("an internal key through a PUBLIC host gets no fallback (attacker cannot forge a loopback Host on a public socket)", () => {
    expect(resolveClientIp(req({ host: "gateway.example.com" }), { isInternal: true })).toBeNull();
  });
});

// ── full-gate integration ──────────────────────────────────────────────────

describe("authorizeApiRequest — W3 stages wired end-to-end", () => {
  it("allowlisted key + trusted header match → ok; mismatch → 403 ip_not_allowed", async () => {
    mocks.resolveKey.mockResolvedValue(row({ ipAllowlist: '["10.0.0.0/8"]' }));
    const ok = await authorizeApiRequest(req({ ...VALID_BEARER, "x-9r-real-ip": "10.1.2.3" }), { settings: SETTINGS });
    expect(ok.ok).toBe(true);
    const denied = await authorizeApiRequest(req({ ...VALID_BEARER, "x-9r-real-ip": "203.0.113.9" }), { settings: SETTINGS });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.IP_NOT_ALLOWED);
    expect(denied.status).toBe(403);
  });

  it("allowlisted key with NO resolvable client IP fails closed through the gate", async () => {
    mocks.resolveKey.mockResolvedValue(row({ ipAllowlist: '["10.0.0.0/8"]' }));
    const res = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(GATE_CODES.IP_NOT_ALLOWED);
  });

  it("explicit clientIp option takes precedence over the header", async () => {
    mocks.resolveKey.mockResolvedValue(row({ ipAllowlist: '["10.0.0.0/8"]' }));
    const res = await authorizeApiRequest(
      req({ ...VALID_BEARER, "x-9r-real-ip": "203.0.113.9" }),
      { settings: SETTINGS, clientIp: "10.9.9.9" }
    );
    expect(res.ok).toBe(true);
  });

  it("rate limit enforced through the gate — 429 rate_limited after rpm", async () => {
    vi.useFakeTimers();
    mocks.resolveKey.mockResolvedValue(row({ rateLimitRpm: 2 }));
    const call = () => authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect((await call()).ok).toBe(true);
    expect((await call()).ok).toBe(true);
    const denied = await call();
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe(GATE_CODES.RATE_LIMITED);
    expect(denied.status).toBe(429);
  });

  it("token budget enforced through the gate — 429 budget_exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const keyId = "kid" + "0".repeat(29);
    mocks.resolveKey.mockResolvedValue(row({ tokenBudgetDaily: 100, budgetScope: "daily" }));
    mocks.getAdapter.mockResolvedValue(
      ledgerDb([usageRow("2026-08-14", keyId, { prompt: 80, completion: 80 })])
    );
    const res = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(GATE_CODES.BUDGET_EXCEEDED);
    expect(res.status).toBe(429);
  });

  it("stage precedence: ip denial beats rate, rate beats budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00"));
    const keyId = "kid" + "0".repeat(29);
    // An expired, allowlisted, rate-limited key from a foreign IP → ip stage wins
    mocks.resolveKey.mockResolvedValue(
      row({ rateLimitRpm: 1, tokenBudgetDaily: 1, budgetScope: "daily", ipAllowlist: '["10.0.0.0/8"]' })
    );
    mocks.getAdapter.mockResolvedValue(
      ledgerDb([usageRow("2026-08-14", keyId, { prompt: 999999 })])
    );
    const res = await authorizeApiRequest(req({ ...VALID_BEARER, "x-9r-real-ip": "203.0.113.9" }), { settings: SETTINGS });
    expect(res.code).toBe(GATE_CODES.IP_NOT_ALLOWED);
  });

  it("REGRESSION: model-test self-call (internal key, loopback Host, no custom-server header) passes", async () => {
    // The model-test ping authenticates as the loopback-pinned internal key and
    // fetches its own /v1. In dev (plain `next dev`), custom-server.js is not
    // loaded, so no x-9r-real-ip is stamped — the gate must resolve the client
    // via the loopback Host fallback for internal keys.
    mocks.resolveKey.mockResolvedValue(
      row({ isInternal: 1, ipAllowlist: '["127.0.0.1/32","::1/128"]' })
    );
    const res = await authorizeApiRequest(
      req({ ...VALID_BEARER, host: "localhost:32060" }),
      { settings: SETTINGS, allowInternal: true }
    );
    expect(res.ok).toBe(true);
  });

  it("REGRESSION guard: an external allowlisted key via loopback Host (no custom-server) still fails closed", async () => {
    // The Host fallback must NOT widen external keys — only internal ones get it.
    mocks.resolveKey.mockResolvedValue(
      row({ isInternal: 0, ipAllowlist: '["127.0.0.1/32","::1/128"]' })
    );
    const res = await authorizeApiRequest(
      req({ ...VALID_BEARER, host: "localhost:32060" }),
      { settings: SETTINGS }
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe(GATE_CODES.IP_NOT_ALLOWED);
    expect(res.status).toBe(403);
  });
});
