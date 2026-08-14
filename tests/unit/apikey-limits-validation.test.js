// Test covenant: apikey-limits-validation — W3 governance field validation.
// Plan: plans/vela-key-governance.md §7. Two layers:
//   1. validateKeyLimits unit matrix (pure, no DB) — shapes, ranges, scopes,
//      CIDR syntax, expiry-future, normalization.
//   2. Route + repo integration — POST mints with limits, PUT mutates them,
//      invalid values surface honest 400s, and the whitelist still holds.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Layer 1: pure validation matrix ────────────────────────────────────────

const { validateKeyLimits, KeyLimitsValidationError, BUDGET_SCOPES } = await import("@/lib/db/keyLimits.js");

describe("validateKeyLimits — pure matrix", () => {
  it("empty input validates to empty values (partial updates pass through)", () => {
    const r = validateKeyLimits({});
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({});
  });

  it("null clears every limit field (unlimited / unrestricted)", () => {
    const r = validateKeyLimits({
      rateLimitRpm: null, tokenBudgetDaily: null, spendCapDailyCents: null,
      budgetScope: null, expiresAt: null, ipAllowlist: null,
    });
    expect(r.ok).toBe(true);
    expect(r.values.rateLimitRpm).toBeNull();
    expect(r.values.ipAllowlist).toBeNull();
  });

  const badInts = [0, -1, 1.5, "10", true, {}, []];
  for (const bad of badInts) {
    it(`integer fields reject ${JSON.stringify(bad)}`, () => {
      for (const f of ["rateLimitRpm", "tokenBudgetDaily", "spendCapDailyCents"]) {
        const r = validateKeyLimits({ [f]: bad });
        expect(r.ok, `${f} accepted ${JSON.stringify(bad)}`).toBe(false);
        expect(r.errors[0]).toContain(f);
      }
    });
  }

  it("positive integers pass and are preserved exactly", () => {
    const r = validateKeyLimits({ rateLimitRpm: 60, tokenBudgetDaily: 1_000_000, spendCapDailyCents: 500 });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ rateLimitRpm: 60, tokenBudgetDaily: 1_000_000, spendCapDailyCents: 500 });
  });

  it("budgetScope accepts only the sealed set", () => {
    for (const s of BUDGET_SCOPES) expect(validateKeyLimits({ budgetScope: s }).ok).toBe(true);
    for (const bad of ["hourly", "DAILY", "week", 42]) {
      const r = validateKeyLimits({ budgetScope: bad });
      expect(r.ok, `accepted scope ${JSON.stringify(bad)}`).toBe(false);
      expect(r.errors[0]).toContain("budgetScope");
    }
  });

  it("expiresAt — future ISO passes and normalizes; past and garbage fail", () => {
    const ok = validateKeyLimits({ expiresAt: "2999-01-01T00:00:00.000Z" });
    expect(ok.ok).toBe(true);
    expect(ok.values.expiresAt).toBe("2999-01-01T00:00:00.000Z");
    for (const bad of ["2000-01-01T00:00:00.000Z", "not-a-date", 12345, ""]) {
      const r = validateKeyLimits({ expiresAt: bad });
      expect(r.ok, `accepted expiresAt ${JSON.stringify(bad)}`).toBe(false);
      expect(r.errors[0]).toContain("expiresAt");
    }
  });

  it("ipAllowlist — valid CIDRs pass, trimmed and deduped", () => {
    const r = validateKeyLimits({ ipAllowlist: [" 10.0.0.0/8 ", "10.0.0.0/8", "2001:db8::/32", "192.168.1.7"] });
    expect(r.ok).toBe(true);
    expect(r.values.ipAllowlist).toEqual(["10.0.0.0/8", "2001:db8::/32", "192.168.1.7"]);
  });

  it("ipAllowlist — malformed entries, non-arrays, and oversized lists fail", () => {
    for (const bad of [["10.0.0.256"], ["abc"], [""], ["10.0.0.0/33"], "10.0.0.0/8", 42, {}]) {
      const r = validateKeyLimits({ ipAllowlist: bad });
      expect(r.ok, `accepted ipAllowlist ${JSON.stringify(bad)}`).toBe(false);
      expect(r.errors[0]).toContain("ipAllowlist");
    }
    const huge = Array.from({ length: 101 }, (_, i) => `10.${i % 256}.0.0/16`);
    expect(validateKeyLimits({ ipAllowlist: huge }).ok).toBe(false);
  });

  it("collects every problem in one pass (all errors, not first error)", () => {
    const r = validateKeyLimits({ rateLimitRpm: -1, budgetScope: "hourly", expiresAt: "2000-01-01" });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(3);
  });

  it("KeyLimitsValidationError joins all errors in its message", () => {
    const e = new KeyLimitsValidationError(["a", "b"]);
    expect(e.message).toBe("a; b");
    expect(e.errors).toEqual(["a", "b"]);
    expect(e.name).toBe("KeyLimitsValidationError");
  });
});

// ── Layer 2: routes + repo over a real temp DB ─────────────────────────────

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-limits-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "limits-test-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

async function loadRoutes() {
  const listRoutes = await import("@/app/api/keys/route.js");
  const idRoutes = await import("@/app/api/keys/[id]/route.js");
  return { listRoutes, idRoutes };
}

const post = (body) =>
  new Request("http://localhost/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const put = (id, body) =>
  new Request(`http://localhost/api/keys/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function createKey(routes, over = {}) {
  const res = await routes.listRoutes.POST(post({ name: "Limit Probe", ...over }));
  expect(res.status).toBe(201);
  return res.json();
}

describe("POST /api/keys — limits at mint time", () => {
  it("mints with every W3 limit and round-trips them on the record", async () => {
    const routes = await loadRoutes();
    const created = await createKey(routes, {
      rateLimitRpm: 120,
      tokenBudgetDaily: 10_000_000,
      spendCapDailyCents: 2500,
      budgetScope: "monthly",
      expiresAt: "2999-01-01T00:00:00.000Z",
      ipAllowlist: ["10.0.0.0/8", "192.168.1.0/24"],
    });
    const rec = created.record;
    expect(rec.rateLimitRpm).toBe(120);
    expect(rec.tokenBudgetDaily).toBe(10_000_000);
    expect(rec.spendCapDailyCents).toBe(2500);
    expect(rec.budgetScope).toBe("monthly");
    expect(rec.expiresAt).toBe("2999-01-01T00:00:00.000Z");
    expect(rec.ipAllowlist).toEqual(["10.0.0.0/8", "192.168.1.0/24"]);
  });

  it("mints with all limits omitted — every governance field null (unlimited)", async () => {
    const routes = await loadRoutes();
    const created = await createKey(routes);
    const rec = created.record;
    expect(rec.rateLimitRpm).toBeNull();
    expect(rec.tokenBudgetDaily).toBeNull();
    expect(rec.spendCapDailyCents).toBeNull();
    expect(rec.budgetScope).toBeNull();
    expect(rec.expiresAt).toBeNull();
    expect(rec.ipAllowlist).toBeNull();
  });

  it("rejects invalid limits with a 400 naming the offender — no key is minted", async () => {
    const routes = await loadRoutes();
    const res = await routes.listRoutes.POST(post({ name: "Bad", rateLimitRpm: -5, budgetScope: "hourly" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("rateLimitRpm");
    expect(body.error).toContain("budgetScope");
    const list = await routes.listRoutes.GET(new Request("http://localhost/api/keys"));
    expect((await list.json()).total).toBe(0);
  });
});

describe("PUT /api/keys/[id] — limits mutation", () => {
  it("updates each limit field and clears with null", async () => {
    const routes = await loadRoutes();
    const { keyId } = await createKey(routes);

    let res = await routes.idRoutes.PUT(put(keyId, { rateLimitRpm: 30, budgetScope: "weekly" }), { params: Promise.resolve({ id: keyId }) });
    expect(res.status).toBe(200);
    let rec = (await res.json()).key;
    expect(rec.rateLimitRpm).toBe(30);
    expect(rec.budgetScope).toBe("weekly");

    res = await routes.idRoutes.PUT(put(keyId, { rateLimitRpm: null }), { params: Promise.resolve({ id: keyId }) });
    rec = (await res.json()).key;
    expect(rec.rateLimitRpm).toBeNull();
    expect(rec.budgetScope).toBe("weekly"); // untouched fields survive
  });

  it("updates ipAllowlist — normalized, and cleared with null", async () => {
    const routes = await loadRoutes();
    const { keyId } = await createKey(routes);
    let res = await routes.idRoutes.PUT(put(keyId, { ipAllowlist: [" 172.16.0.0/12 ", "172.16.0.0/12"] }), { params: Promise.resolve({ id: keyId }) });
    expect((await res.json()).key.ipAllowlist).toEqual(["172.16.0.0/12"]);
    res = await routes.idRoutes.PUT(put(keyId, { ipAllowlist: null }), { params: Promise.resolve({ id: keyId }) });
    expect((await res.json()).key.ipAllowlist).toBeNull();
  });

  const invalidMatrix = [
    [{ rateLimitRpm: 0 }, "rateLimitRpm"],
    [{ tokenBudgetDaily: "lots" }, "tokenBudgetDaily"],
    [{ spendCapDailyCents: -100 }, "spendCapDailyCents"],
    [{ budgetScope: "quarterly" }, "budgetScope"],
    [{ expiresAt: "2000-01-01T00:00:00.000Z" }, "expiresAt"],
    [{ expiresAt: "garbage" }, "expiresAt"],
    [{ ipAllowlist: ["999.1.1.1"] }, "ipAllowlist"],
    [{ ipAllowlist: "10.0.0.0/8" }, "ipAllowlist"],
  ];

  for (const [body, offender] of invalidMatrix) {
    it(`rejects ${JSON.stringify(body)} with a 400 naming ${offender}`, async () => {
      const routes = await loadRoutes();
      const { keyId } = await createKey(routes);
      const res = await routes.idRoutes.PUT(put(keyId, body), { params: Promise.resolve({ id: keyId }) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(offender);
    });
  }

  it("an invalid PUT leaves the stored row untouched", async () => {
    const routes = await loadRoutes();
    const { keyId } = await createKey(routes, { rateLimitRpm: 45 });
    const res = await routes.idRoutes.PUT(put(keyId, { rateLimitRpm: -1 }), { params: Promise.resolve({ id: keyId }) });
    expect(res.status).toBe(400);
    const get = await routes.idRoutes.GET(new Request(`http://localhost/api/keys/${keyId}`), { params: Promise.resolve({ id: keyId }) });
    expect((await get.json()).key.rateLimitRpm).toBe(45);
  });

  it("the whitelist still holds — security fields pass through unmodified", async () => {
    const routes = await loadRoutes();
    const { keyId, keyPrefix } = await createKey(routes);
    const res = await routes.idRoutes.PUT(
      put(keyId, { keyHash: "attacker-hash", keyPrefix: "vela-v1-hack…", isInternal: 1 }),
      { params: Promise.resolve({ id: keyId }) }
    );
    expect(res.status).toBe(200);
    const rec = (await res.json()).key;
    expect(rec.keyPrefix).toBe(keyPrefix);
    expect(rec.isInternal).toBe(false);
  });
});
