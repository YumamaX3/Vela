// Usage Observatory W3-A — quotaRepo contract test.
//
// Budget definitions ride the kv store (scope "budgets") — the sealed plan
// reserves migration 009 for W4 saved views, so W3's budget engine persists
// its definitions as CONFIG. This test pins the contract: the frozen
// vocabulary (scopes gateway|key|model, windows day|week|month, thresholds
// 50/80/100), honest validation errors, deterministic ordering, cache
// invalidation on writes, and the distinct budget-id shape.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w3a-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function repo() {
  return import("@/lib/db/repos/budgetRepo.js");
}

describe("W3-A quotaRepo — the frozen vocabulary", () => {
  it("accepts a gateway budget with subject null", async () => {
    const r = await repo();
    const def = await r.upsertBudget({ scope: "gateway", subject: null, window: "day", tokenCap: 1_000_000, spendCapCents: null });
    expect(def.id).toBe("gateway:*");
    expect(def.subject).toBeNull();
    expect(def.thresholds).toEqual([50, 80, 100]);
    expect(def.isActive).toBe(true);
  });

  it("accepts a key budget bound to its keyId", async () => {
    const r = await repo();
    const def = await r.upsertBudget({ scope: "key", subject: "key-abc", window: "month", tokenCap: null, spendCapCents: 5000 });
    expect(def.id).toBe("key:key-abc");
    expect(def.spendCapCents).toBe(5000);
  });

  it("accepts a model budget bound to provider/model", async () => {
    const r = await repo();
    const def = await r.upsertBudget({ scope: "model", subject: "openai/gpt-4o", window: "week", tokenCap: 100_000, spendCapCents: 2500 });
    expect(def.id).toBe("model:openai/gpt-4o");
    expect(def.window).toBe("week");
  });
});

describe("W3-A quotaRepo — honest validation", () => {
  const cases = [
    ["unknown scope is rejected", { scope: "provider", window: "day", tokenCap: 1 }, /scope must be one of/],
    ["unknown window is rejected", { scope: "gateway", window: "year", tokenCap: 1 }, /window must be one of/],
    ["key budget without subject is rejected", { scope: "key", subject: "", window: "day", tokenCap: 1 }, /key budget requires subject/],
    ["model budget without subject is rejected", { scope: "model", window: "day", tokenCap: 1 }, /model budget requires subject/],
    ["gateway budget WITH subject is rejected", { scope: "gateway", subject: "x", window: "day", tokenCap: 1 }, /gateway budget takes no subject/],
    ["zero tokenCap is rejected", { scope: "gateway", window: "day", tokenCap: 0 }, /tokenCap must be a positive integer/],
    ["negative spendCapCents is rejected", { scope: "gateway", window: "day", spendCapCents: -5 }, /spendCapCents must be a positive integer/],
    ["no caps at all is rejected", { scope: "gateway", window: "day" }, /needs at least one cap/],
  ];
  for (const [name, input, pattern] of cases) {
    it(name, async () => {
      const r = await repo();
      await expect(r.upsertBudget(input)).rejects.toThrow(pattern);
    });
  }
});

describe("W3-A quotaRepo — persistence, ordering, cache", () => {
  it("round-trips through the kv store across a fresh module load", async () => {
    const r = await repo();
    await r.upsertBudget({ scope: "gateway", window: "day", tokenCap: 10 });
    await r.upsertBudget({ scope: "key", subject: "k1", window: "day", spendCapCents: 99 });
    // Fresh module = fresh in-process cache; data must come from the store.
    vi.resetModules();
    const r2 = await repo();
    const list = await r2.listBudgets();
    expect(list.length).toBe(2);
    expect(list.map((b) => b.id).sort()).toEqual(["gateway:*", "key:k1"]);
    expect((await r2.getBudget("gateway:*")).tokenCap).toBe(10);
  });

  it("orders active budgets first, then scope, then id", async () => {
    const r = await repo();
    await r.upsertBudget({ scope: "model", subject: "openai/gpt-4o", window: "day", tokenCap: 1 });
    await r.upsertBudget({ scope: "gateway", window: "day", tokenCap: 1 });
    await r.upsertBudget({ scope: "key", subject: "k1", window: "day", tokenCap: 1 });
    await r.setBudgetActive("gateway:*", false);
    const list = await r.listBudgets();
    expect(list.map((b) => b.id)).toEqual(["key:k1", "model:openai/gpt-4o", "gateway:*"]);
  });

  it("cache invalidates on write — a removed budget disappears immediately", async () => {
    const r = await repo();
    await r.upsertBudget({ scope: "gateway", window: "day", tokenCap: 1 });
    expect((await r.listBudgets()).length).toBe(1);
    expect(await r.removeBudget("gateway:*")).toBe(true);
    expect((await r.listBudgets()).length).toBe(0);
    expect(await r.getBudget("gateway:*")).toBeNull();
    expect(await r.removeBudget("gateway:*")).toBe(false); // gone — honest false
  });

  it("upsert replaces an existing definition by id", async () => {
    const r = await repo();
    await r.upsertBudget({ scope: "key", subject: "k1", window: "day", tokenCap: 100 });
    await r.upsertBudget({ scope: "key", subject: "k1", window: "month", spendCapCents: 777, tokenCap: null });
    const list = await r.listBudgets();
    expect(list.length).toBe(1);
    expect(list[0].window).toBe("month");
    expect(list[0].spendCapCents).toBe(777);
    expect(list[0].tokenCap).toBeNull();
  });
});
