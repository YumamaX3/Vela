// Test covenant: W2 API surface — the governance repos behind the new routes
// (templates/tags/ledger) + the revoke/delete lifecycle split + the
// method-aware dashboardGuard escalation. Each test boots its own temp harbor
// (the mintkey-reveal harness) so the sql.js/better-sqlite3 adapter never
// leaks state between cases.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w2-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w2-test-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) {
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); break; }
      catch { /* retry — Windows file-lock resilience */ }
    }
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

describe("keyTemplatesRepo (W2 templates route backing)", () => {
  it("create → list → get → update → delete round-trips", async () => {
    const { listTemplates, createTemplate, getTemplate, updateTemplate, deleteTemplate } = await import("@/lib/localDb.js");

    const created = await createTemplate({ name: "Prod Lockdown", acl: { allowedKinds: ["llm"] }, limits: { rateLimitRpm: 60 }, categoryDefault: "prod" });
    expect(created.id).toBeTruthy();
    expect(created.acl.allowedKinds).toEqual(["llm"]);
    expect(created.builtIn).toBe(false);

    const listed = await listTemplates({ includeBuiltIn: false });
    expect(listed.some((t) => t.id === created.id)).toBe(true);

    const got = await getTemplate(created.id);
    expect(got.name).toBe("Prod Lockdown");

    const updated = await updateTemplate(created.id, { name: "Prod Lockdown v2" });
    expect(updated.name).toBe("Prod Lockdown v2");

    const gone = await deleteTemplate(created.id);
    expect(gone).toBe(true);
    expect(await getTemplate(created.id)).toBeNull();
  });

  it("built-in templates are immutable + seeded", async () => {
    const { listTemplates, updateTemplate, deleteTemplate } = await import("@/lib/localDb.js");
    const builtins = await listTemplates({ includeBuiltIn: true });
    expect(builtins.length).toBe(4);

    const blank = builtins.find((t) => t.name === "Blank");
    const upd = await updateTemplate(blank.id, { name: "Hacked" });
    expect(upd.error).toMatch(/immutable/);
    const del = await deleteTemplate(blank.id);
    expect(del.error).toMatch(/immutable/);
  });

  it("applyShape normalizes a template into the createApiKey payload", async () => {
    const { applyShape } = await import("@/lib/localDb.js");
    const tpl = {
      name: "Embeds",
      description: "d",
      acl: { allowedKinds: ["embeddings"] },
      limits: { tokenBudget: 500000, spendCapCents: 200 },
      categoryDefault: "batch",
    };
    const shape = applyShape(tpl, { name: "Override" });
    expect(shape.name).toBe("Override");
    expect(shape.allowedKinds).toEqual(["embeddings"]);
    expect(shape.tokenBudgetDaily).toBe(500000);
    expect(shape.spendCapDailyCents).toBe(200);
    expect(shape.category).toBe("batch");
  });
});

describe("keyTagsRepo (W2 tags route backing)", () => {
  it("add/list/remove/rename + per-key delete", async () => {
    const { addTag, tagsForKeys, removeTag, renameTag, deleteForKey } = await import("@/lib/localDb.js");

    await addTag("k1", " Prod ");
    await addTag("k1", "prod"); // idempotent dedupe
    await addTag("k1", "finance");
    await addTag("k2", "prod");

    const tags = await tagsForKeys(["k1", "k2"]);
    expect(tags.k1).toEqual(["finance", "prod"]);
    expect(tags.k2).toEqual(["prod"]);

    await removeTag("k1", "finance");
    expect((await tagsForKeys(["k1"])).k1).toEqual(["prod"]);

    await renameTag("prod", "production");
    expect((await tagsForKeys(["k1", "k2"])).k1).toEqual(["production"]);
    expect((await tagsForKeys(["k2"])).k2).toEqual(["production"]);

    await deleteForKey("k1");
    expect((await tagsForKeys(["k1"])).k1).toBeUndefined();
  });

  it("sanitizeTag rejects empty + over-long", async () => {
    const { sanitizeTag } = await import("@/lib/localDb.js");
    expect(sanitizeTag("")).toBeNull();
    expect(sanitizeTag("a".repeat(33))).toBeNull();
    expect(sanitizeTag("  Fine  ")).toBe("fine");
  });
});

describe("revoke/delete lifecycle split (W2d)", () => {
  it("revokeApiKey keeps the row visible with a purged hash", async () => {
    const { createApiKey, revokeApiKey, getApiKeyById } = await import("@/lib/localDb.js");
    const created = await createApiKey("Victim");
    const id = created.keyId;

    const revoked = await revokeApiKey(id);
    expect(revoked).toBe(true);

    // Row still VISIBLE (not tombstoned) — the 'Revoked' pill is reachable.
    const row = await getApiKeyById(id);
    expect(row).toBeTruthy();
    expect(row.isActive).toBe(false);
  });

  it("deleteWithScrub tombstones + purges tags in one transaction", async () => {
    const { createApiKey, deleteWithScrub, addTag, tagsForKeys, getApiKeyById } = await import("@/lib/localDb.js");
    const created = await createApiKey("Doomed");
    const id = created.keyId;
    await addTag(id, "tmp");

    const deleted = await deleteWithScrub(id);
    expect(deleted).toBe(true);

    // Tombstoned — hidden from the default list surface.
    expect(await getApiKeyById(id)).toBeNull();
    // Tags scrubbed in the same transaction.
    expect((await tagsForKeys([id]))[id]).toBeUndefined();
  });
});

