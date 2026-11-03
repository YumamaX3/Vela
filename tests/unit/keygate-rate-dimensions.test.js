// Test covenant: keygate-rate-dimensions — the five-dimension per-key rate
// limits (migration 025). Wave-1 enforced only RPM in an in-memory 60s window;
// this tide ports Pro's shape natively:
//
//   rpm / rph / rpd — one shared in-memory stamp log, per-window honest
//                     Retry-After (the k-th oldest in-window stamp, where
//                     k = stamps - limit + 1 — the FIRST slot to free)
//   tpm             — summed from the usage ledger (usageRepo.getKeyWindowsSince)
//   maxConcurrentRequests — in-flight slot counter, released on settle,
//                     15-min TTL safety net
//
// Laws proven here:
//   • each dimension alone crosses to 429 with the correct Retry-After
//   • every dimension is reported through the gate with the same header
//   • unlimited / 0 / null / absent keys pass on every dimension
//   • a DB error on the TPM read is a PASS (fail-open on an unreadable ceiling)
//   • a denial never consumes a slot or a stamp (no side effects on 429)
//   • the slot is released in BOTH settle arms, and the TTL net frees a leak
//   • validation accepts the four new optional positive ints and rejects junk
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveKey: vi.fn(),
  getApiKeyById: vi.fn(),
  getAdapter: vi.fn(),
  getKeyWindowsSince: vi.fn(),
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  resolveKey: mocks.resolveKey,
  getApiKeyById: mocks.getApiKeyById,
}));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({
  touchKeyLastUsed: vi.fn().mockResolvedValue(undefined),
  getUsageDailySince: vi.fn().mockResolvedValue([]),
  getKeyWindowsSince: mocks.getKeyWindowsSince,
}));

const {
  authorizeApiRequest,
  rateStage,
  tokenRateStage,
  rateAsyncStage,
  incrementSlot,
  inflightCount,
  withKeySlot,
  CONCURRENCY_SLOT_TTL_MS,
  GATE_CODES,
} = await import("@/sse/services/keyGate.js");
const { validateKeyLimits } = await import("@/lib/db/keyLimits.js");

const SETTINGS = { requireApiKey: true };
const VALID_BEARER = { Authorization: "Bearer sk-vela-test-token" };
const T0 = new Date("2026-11-02T12:00:00Z").getTime();

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
    rateLimitTpm: null,
    rateLimitRph: null,
    rateLimitRpd: null,
    maxConcurrentRequests: null,
    tokenBudgetDaily: null,
    spendCapDailyCents: null,
    budgetScope: null,
    ipAllowlist: null,
    ...over,
  };
}

/** A fresh keyId per test — the window map and slot map are global singletons. */
let seq = 0;
const freshKeyId = () => `rate-dims-${Date.now()}-${++seq}`;
const retryAfterOf = (verdict) => Number(verdict.headers?.["Retry-After"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
  mocks.resolveKey.mockReset();
  mocks.getAdapter.mockReset();
  mocks.getKeyWindowsSince.mockReset();
  mocks.getKeyWindowsSince.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateStage — the three request windows share ONE stamp log", () => {
  it("RPM alone: the (n+1)th request in 60s is a 429 with Retry-After on the oldest stamp", () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 2 };
    expect(rateStage(key).ok).toBe(true); // stamp at T0
    vi.advanceTimersByTime(10_000);
    expect(rateStage(key).ok).toBe(true); // stamp at T0+10s
    vi.advanceTimersByTime(5_000); // now = T0+15s
    const verdict = rateStage(key);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(GATE_CODES.RATE_LIMITED);
    expect(verdict.status).toBe(429);
    // First slot frees when stamp 1 ages out at T0+60s → 45s left.
    expect(retryAfterOf(verdict)).toBe(45);
    expect(verdict.response.headers.get("Retry-After")).toBe("45");
    // A denial consumed no stamp: still exactly the two admitted stamps.
    expect(rateStage(key).ok).toBe(false);
  });

  it("RPH alone: a key under its per-minute pace still crosses its hourly ceiling", () => {
    const key = { keyId: freshKeyId(), rateLimitRph: 3 };
    for (let i = 0; i < 3; i++) {
      expect(rateStage(key).ok).toBe(true);
      vi.advanceTimersByTime(5 * 60_000); // never more than 3 in any 60s
    }
    // now = T0 + 15min; three stamps span 15min — first ages out at T0+1h.
    const verdict = rateStage(key);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("3 requests per hour");
    expect(retryAfterOf(verdict)).toBe(45 * 60);
  });

  it("RPD alone: a key under every other ceiling still crosses its daily ceiling", () => {
    const key = { keyId: freshKeyId(), rateLimitRpd: 2 };
    expect(rateStage(key).ok).toBe(true);
    vi.advanceTimersByTime(6 * 3600_000);
    expect(rateStage(key).ok).toBe(true);
    vi.advanceTimersByTime(6 * 3600_000); // now = T0 + 12h
    const verdict = rateStage(key);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("2 requests per day");
    expect(retryAfterOf(verdict)).toBe(12 * 3600); // first stamp ages out at T0+24h
  });

  it("every request dimension set: the TIGHTEST crossed window is the one reported", () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 60, rateLimitRph: 3, rateLimitRpd: 1000 };
    for (let i = 0; i < 3; i++) {
      expect(rateStage(key).ok).toBe(true);
      vi.advanceTimersByTime(5_000);
    }
    const verdict = rateStage(key);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("3 requests per hour"); // rpm (60) not crossed
  });

  it("Retry-After clears honestly: the window frees exactly when promised", () => {
    const key = { keyId: freshKeyId(), rateLimitRpm: 1 };
    expect(rateStage(key).ok).toBe(true);
    vi.advanceTimersByTime(20_000);
    const verdict = rateStage(key);
    expect(retryAfterOf(verdict)).toBe(40);
    vi.advanceTimersByTime(40_000); // the promised instant
    expect(rateStage(key).ok).toBe(true); // slot genuinely free
  });

  it("unlimited / zero: null, 0 and absent never deny and never stamp", () => {
    for (const over of [{}, { rateLimitRpm: null }, { rateLimitRpm: 0, rateLimitRph: 0, rateLimitRpd: 0 }]) {
      const key = { keyId: freshKeyId(), ...over };
      for (let i = 0; i < 50; i++) {
        const verdict = rateStage(key);
        expect(verdict.ok).toBe(true);
        expect(verdict.headers).toBeUndefined();
      }
    }
  });
});

describe("tokenRateStage (TPM) — a soft check over the usage ledger", () => {
  it("summed tokens over the 60s ceiling → 429, Retry-After from the oldest ledger row", () => {
    const key = { keyId: freshKeyId(), rateLimitTpm: 1000 };
    mocks.getKeyWindowsSince.mockResolvedValue({
      requests: 3, tokens: 1500, oldestAt: new Date(T0 - 20_000).toISOString(),
    });
    return tokenRateStage(key).then((verdict) => {
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe(GATE_CODES.RATE_LIMITED);
      expect(verdict.message).toContain("1000 tokens per minute");
      // Oldest row ages out of the 60s window at T0+40s → 40s left.
      expect(retryAfterOf(verdict)).toBe(40);
      const [keyId, sinceMs] = mocks.getKeyWindowsSince.mock.calls[0];
      expect(keyId).toBe(key.keyId);
      expect(sinceMs).toBe(T0 - 60_000);
    });
  });

  it("tokens UNDER the ceiling pass; exactly AT the ceiling denies (>=)", async () => {
    const under = { keyId: freshKeyId(), rateLimitTpm: 1000 };
    mocks.getKeyWindowsSince.mockResolvedValue({ tokens: 999, oldestAt: new Date(T0).toISOString() });
    expect((await tokenRateStage(under)).ok).toBe(true);

    const at = { keyId: freshKeyId(), rateLimitTpm: 1000 };
    mocks.getKeyWindowsSince.mockResolvedValue({ tokens: 1000, oldestAt: new Date(T0).toISOString() });
    expect((await tokenRateStage(at)).ok).toBe(false);
  });

  it("DB ERROR on the TPM read reads as PASS — an unreadable ceiling never locks a key out", async () => {
    const key = { keyId: freshKeyId(), rateLimitTpm: 1 };
    mocks.getKeyWindowsSince.mockRejectedValue(new Error("sqlite is busy"));
    const verdict = await tokenRateStage(key);
    expect(verdict.ok).toBe(true);
    expect(verdict.response).toBeUndefined();
  });

  it("no TPM ceiling → the ledger is never read", async () => {
    const verdict = await tokenRateStage({ keyId: freshKeyId(), rateLimitTpm: null });
    expect(verdict.ok).toBe(true);
    expect(mocks.getKeyWindowsSince).not.toHaveBeenCalled();
  });
});

describe("maxConcurrentRequests — in-flight slots", () => {
  it("a full slot count → 429; a settled slot frees the next request", () => {
    const key = { keyId: freshKeyId(), maxConcurrentRequests: 2 };
    const a = incrementSlot(key);
    const b = incrementSlot(key);
    expect(a.ok && b.ok).toBe(true);
    expect(inflightCount(key.keyId)).toBe(2);

    const verdict = rateAsyncStage(key);
    return verdict.then((v) => {
      expect(v.ok).toBe(false);
      expect(v.message).toContain("2 concurrent requests");
      expect(retryAfterOf(v)).toBeGreaterThanOrEqual(1);

      a.release();
      a.release(); // idempotent — a double release never frees someone else's slot
      expect(inflightCount(key.keyId)).toBe(1);
      const c = incrementSlot(key);
      expect(c.ok).toBe(true);
      b.release();
      c.release();
      expect(inflightCount(key.keyId)).toBe(0);
    });
  });

  it("the 15-minute TTL safety net frees a leaked slot by itself", () => {
    const key = { keyId: freshKeyId(), maxConcurrentRequests: 1 };
    const leaked = incrementSlot(key); // never released — a hung stream
    expect(inflightCount(key.keyId)).toBe(1);
    expect(incrementSlot(key).ok).toBe(false);

    vi.advanceTimersByTime(CONCURRENCY_SLOT_TTL_MS + 1);
    expect(inflightCount(key.keyId)).toBe(0);
    const next = incrementSlot(key);
    expect(next.ok).toBe(true);
    next.release();
    leaked.release(); // late release after reclaim must not double-free
    expect(inflightCount(key.keyId)).toBe(0);
  });

  it("no ceiling: incrementSlot is a no-op that still returns a release function", () => {
    for (const max of [null, 0, undefined]) {
      const slot = incrementSlot({ keyId: freshKeyId(), maxConcurrentRequests: max });
      expect(slot.ok).toBe(true);
      expect(typeof slot.release).toBe("function");
      slot.release();
    }
  });

  it("withKeySlot releases in BOTH settle arms and on throw", async () => {
    const key = { keyId: freshKeyId(), maxConcurrentRequests: 1 };

    const g1 = { ok: true, release: incrementSlot(key).release };
    await withKeySlot(g1, async () => "value");
    expect(inflightCount(key.keyId)).toBe(0);

    const g2 = { ok: true, release: incrementSlot(key).release };
    await expect(withKeySlot(g2, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(inflightCount(key.keyId)).toBe(0);

    const g3 = { ok: true, release: incrementSlot(key).release };
    expect(() => withKeySlot(g3, () => { throw new Error("sync boom"); })).toThrow("sync boom");
    expect(inflightCount(key.keyId)).toBe(0);

    // A keyless verdict carries no release — the wrapper still works.
    await expect(withKeySlot({ ok: true }, async () => 7)).resolves.toBe(7);
  });

  it("rateAsyncStage checks TPM BEFORE taking a slot — a token denial leaks nothing", async () => {
    const key = { keyId: freshKeyId(), rateLimitTpm: 10, maxConcurrentRequests: 1 };
    mocks.getKeyWindowsSince.mockResolvedValue({ tokens: 50, oldestAt: new Date(T0).toISOString() });
    const verdict = await rateAsyncStage(key);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("tokens per minute");
    expect(inflightCount(key.keyId)).toBe(0);
  });
});

describe("authorizeApiRequest — all five dimensions through THE gate", () => {
  async function run(over) {
    const keyId = freshKeyId();
    mocks.resolveKey.mockResolvedValue(row({ id: keyId, ...over }));
    return authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
  }

  it("RPM row → 429 with Retry-After", async () => {
    mocks.resolveKey.mockImplementation(async () => row({ id: "gate-rpm", rateLimitRpm: 1 }));
    expect((await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS })).ok).toBe(true);
    const verdict = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(verdict.ok).toBe(false);
    expect(verdict.headers["Retry-After"]).toBe("60");
  });

  it("RPH row → 429 (projected from the DB row, not just the fake key shape)", async () => {
    mocks.getAdapter.mockReset();
    mocks.resolveKey.mockImplementation(async () => row({ id: "gate-rph", rateLimitRph: 1 }));
    expect((await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS })).ok).toBe(true);
    vi.advanceTimersByTime(60_000);
    const verdict = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("1 request per hour");
    expect(retryAfterOf(verdict)).toBe(3600 - 60);
  });

  it("TPM row → 429 from the ledger sum, and a ledger DB error passes", async () => {
    mocks.resolveKey.mockImplementation(async () => row({ id: "gate-tpm", rateLimitTpm: 100 }));
    mocks.getKeyWindowsSince.mockResolvedValue({ tokens: 500, oldestAt: new Date(T0).toISOString() });
    const denied = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(denied.ok).toBe(false);
    expect(denied.message).toContain("100 tokens per minute");

    mocks.getKeyWindowsSince.mockRejectedValue(new Error("db down"));
    const passed = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(passed.ok).toBe(true);
  });

  it("maxConcurrentRequests row → second in-flight request 429s; settle frees it", async () => {
    mocks.resolveKey.mockImplementation(async () => row({ id: "gate-conc", maxConcurrentRequests: 1 }));
    const first = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(first.ok).toBe(true);
    expect(typeof first.release).toBe("function");

    const second = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(second.ok).toBe(false);
    expect(second.message).toContain("1 concurrent requests");

    first.release();
    const third = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
    expect(third.ok).toBe(true);
    third.release();
  });

  it("an unlimited key passes every dimension and carries a harmless release", async () => {
    mocks.resolveKey.mockImplementation(async () => row({ id: freshKeyId() }));
    for (let i = 0; i < 5; i++) {
      const verdict = await authorizeApiRequest(req(VALID_BEARER), { settings: SETTINGS });
      expect(verdict.ok).toBe(true);
      expect(verdict.key.rateLimitTpm).toBeNull();
      expect(verdict.key.maxConcurrentRequests).toBeNull();
      verdict.release();
    }
    expect(mocks.getKeyWindowsSince).not.toHaveBeenCalled();
  });
});

describe("validateKeyLimits — the four new optional positive ints", () => {
  const NEW = ["rateLimitTpm", "rateLimitRph", "rateLimitRpd", "maxConcurrentRequests"];

  it("accepts positive integers and null; absent stays absent", () => {
    const r = validateKeyLimits({ rateLimitTpm: 1000, rateLimitRph: 60, rateLimitRpd: 1000, maxConcurrentRequests: 4 });
    expect(r.ok).toBe(true);
    for (const f of NEW) expect(Number.isInteger(r.values[f])).toBe(true);
    const cleared = validateKeyLimits(Object.fromEntries(NEW.map((f) => [f, null])));
    expect(cleared.ok).toBe(true);
    for (const f of NEW) expect(cleared.values[f]).toBeNull();
    const absent = validateKeyLimits({ name: "x" });
    expect(absent.ok).toBe(true);
    for (const f of NEW) expect(f in absent.values).toBe(false);
  });

  for (const bad of [0, -1, 1.5, "10", true, {}, []]) {
    it(`rejects ${JSON.stringify(bad)} on every new dimension, naming the field`, () => {
      for (const f of NEW) {
        const r = validateKeyLimits({ [f]: bad });
        expect(r.ok, `${f} accepted ${JSON.stringify(bad)}`).toBe(false);
        expect(r.errors[0]).toContain(f);
      }
    });
  }
});
