// Auto combos — family math, stable ids, and the empty-harbor posture.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { modelFamily, autoFamilyComboId, isFreeTierModel } from "@/lib/combos/autoGenerate.js";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-auto-combo-"));
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

describe("auto combos", () => {
  it("groups versions and lifecycle flags into one family", () => {
    expect(modelFamily("claude-sonnet-4.6")).toBe("claude-sonnet");
    expect(modelFamily("claude-sonnet-4.5")).toBe("claude-sonnet");
    expect(modelFamily("gemini-3.1-flash-preview")).toBe("gemini-flash");
    expect(modelFamily("gemini-3-flash-preview")).toBe("gemini-flash");
    expect(modelFamily("kimi-k2.6")).toBe("kimi");
    expect(modelFamily("deepseek-v4.1-flash:free")).toBe("deepseek-flash");
  });

  it("keeps identity words that are not generations", () => {
    expect(modelFamily("o1")).toBe("o1");
    expect(modelFamily("o3-mini")).toBe("o3-mini");
    expect(modelFamily("gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("derives a stable, path-safe combo id", () => {
    expect(autoFamilyComboId("claude-sonnet")).toBe("auto-family-claude-sonnet");
    expect(autoFamilyComboId("openai/gpt-4o")).toBe("auto-family-openai-gpt-4o");
    expect(isFreeTierModel("deepseek-v4.1-flash:free")).toBe(true);
    expect(isFreeTierModel("deepseek-v4.1-flash")).toBe(false);
  });

  it("returns 409 with no free-tier providers and 200 with none to group", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const free = await import("@/app/api/combos/auto-free/route.js");
    expect((await free.POST()).status).toBe(409);

    const family = await import("@/app/api/combos/auto-family/route.js");
    const res = await family.POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", count: 0 });
  });

  it("rewrites one row on rebuild instead of stacking", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const combos = await import("@/lib/db/repos/combosRepo.js");

    await combos.upsertComboWithId("auto-free-tier", { name: "Auto Free Tier", kind: "auto-free", models: ["a/x"] });
    await combos.upsertComboWithId("auto-free-tier", { name: "Auto Free Tier", kind: "auto-free", models: ["a/y"] });
    const all = await combos.getCombos();
    expect(all.filter((c) => c.id === "auto-free-tier")).toHaveLength(1);
    expect((await combos.getComboById("auto-free-tier")).models).toEqual(["a/y"]);
  });
});
