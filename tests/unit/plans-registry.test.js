// Plans registry + inheritance — the template must reach the gate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-plans-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("plans registry", () => {
  it("creates, lists, updates and refuses to delete an inherited plan", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const plans = await import("@/lib/db/repos/plansRepo.js");
    const keys = await import("@/lib/db/repos/apiKeysRepo.js");
    const { clearPlanCache, applyPlanDefaults } = await import("@/sse/services/planDefaults.js");

    const plan = await plans.createPlan({
      name: "Team monthly", description: "shared cap", limitTokens: 500000,
      spendCapCents: 2500, rpmLimit: 60, period: "monthly", allowedModels: ["gpt-4o"],
    });
    expect(plan.id).toBeTruthy();

    const listed = await plans.listPlans();
    expect(listed.map((p) => p.name)).toContain("Team monthly");

    const minted = await keys.createApiKey("plan-key", { planId: plan.id });
    expect(minted.record.planId).toBe(plan.id);
    expect(await plans.countPlanKeys(plan.id)).toBe(1);

    // Inheritance: the key sets nothing, so the plan's limits bind.
    const { resolveKey } = keys;
    const row = await resolveKey(minted.key);
    const resolved = await applyPlanDefaults({
      keyId: row.id, planId: row.planId, tokenBudgetDaily: row.tokenBudgetDaily ?? null,
      spendCapDailyCents: row.spendCapDailyCents ?? null, rateLimitRpm: row.rateLimitRpm ?? null,
      budgetScope: row.budgetScope ?? null, allowedModels: null,
    });
    expect(resolved.tokenBudgetDaily).toBe(500000);
    expect(resolved.spendCapDailyCents).toBe(2500);
    expect(resolved.rateLimitRpm).toBe(60);
    expect(resolved.budgetScope).toBe("monthly");
    expect(resolved.allowedModels).toEqual(["gpt-4o"]);

    // The key's own value wins where set.
    const overridden = await applyPlanDefaults({ keyId: row.id, planId: plan.id, tokenBudgetDaily: 1, spendCapDailyCents: null, rateLimitRpm: null, budgetScope: null, allowedModels: null });
    expect(overridden.tokenBudgetDaily).toBe(1);
    expect(overridden.spendCapDailyCents).toBe(2500);

    // Update is partial: untouched fields keep their stored value.
    const updated = await plans.updatePlan(plan.id, { ...(await plans.getPlan(plan.id)), name: "Team monthly v2" });
    expect(updated.name).toBe("Team monthly v2");
    expect(updated.limitTokens).toBe(500000);

    const route = await import("@/app/api/plans/[id]/route.js");
    const denied = await route.DELETE(new Request("http://localhost/api/plans/x"), { params: Promise.resolve({ id: plan.id }) });
    expect(denied.status).toBe(409);

    clearPlanCache();
    await keys.deleteApiKey(minted.keyId);
    const allowed = await route.DELETE(new Request("http://localhost/api/plans/x"), { params: Promise.resolve({ id: plan.id }) });
    expect(allowed.status).toBe(200);
    expect(await plans.getPlan(plan.id)).toBeNull();
  });
});
