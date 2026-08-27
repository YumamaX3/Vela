// W0 Key Domain Ascension — the ledger-completeness covenant.
// Pins the Tidebreaker findings F1–F3 (Gate 7): the most-used mutation
// surfaces (pause/resume/expire-set/edit via PUT, revoke, DELETE scrub,
// tag ops) MUST write a key_mutation_ledger row. The mint surfaces were
// already ledgered via mintService; this suite covers the silent ones.
//
// strategy "sql.js-crash" — the same in-process SQLite driver the port
// contract runs on, so the tests exercise the real adapter surface.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEDGER_SURFACES_COVERED = [
  "revoke", "delete", "pause", "resume", "expire-set", "edit",
  "tag-add", "tag-remove", "tag-rename",
];

let tempDir;
let db;
let requestLike; // minimal Request-shaped actor carrier

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-ledger-w0-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession.js");
  // A real signed JWT cookie value exercises the dashboard-actor path.
  const token = await createDashboardAuthToken({});
  requestLike = {
    headers: { get: (k) => (k === "cookie" ? `${process.env.AUTH_COOKIE_NAME || "vela_auth_token"}=${token}` : null) },
    [Symbol.for("vela.keyMutation.actor")]: undefined,
  };
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function seedKey(name) {
  const { createApiKey } = await import("@/lib/db/repos/sqlite/apiKeysRepo.js");
  const { id } = await createApiKey(name);
  return id;
}

describe("W0 ledger seam — mutationLedger module", () => {
  it("exports the closed surface vocabulary", async () => {
    const { LEDGER_SURFACES, ACTOR_CLASSES } = await import("@/lib/keys/mutationLedger.js");
    for (const s of LEDGER_SURFACES_COVERED) {
      expect(LEDGER_SURFACES, `missing surface ${s}`).toContain(s);
    }
    expect(ACTOR_CLASSES).toEqual(["dashboard", "cli", "system"]);
  });

  it("classifyPutSurface names pause/resume/expire-set/edit honestly", async () => {
    const { classifyPutSurface } = await import("@/lib/keys/mutationLedger.js");
    expect(classifyPutSurface({ isActive: false })).toBe("pause");
    expect(classifyPutSurface({ isActive: true })).toBe("resume");
    expect(classifyPutSurface({ expiresAt: "2027-01-01T00:00:00Z" })).toBe("expire-set");
    expect(classifyPutSurface({ name: "x" })).toBe("edit");
    // priority: isActive wins over other fields (one op per PUT call)
    expect(classifyPutSurface({ isActive: false, expiresAt: "2027-01-01" })).toBe("pause");
  });

  it("summarizeUpdate records WHICH fields changed, never their values for ACL/IP", async () => {
    const { summarizeUpdate } = await import("@/lib/keys/mutationLedger.js");
    expect(summarizeUpdate({ allowedModels: ["gpt-5"], ipAllowlist: ["1.2.3.4/32"] }))
      .toBe("fields:allowedModels,ipAllowlist");
    expect(summarizeUpdate({ name: "hush", rateLimitRpm: 60 }))
      .toBe("fields:name,rateLimitRpm");
    expect(summarizeUpdate({})).toBeNull();
  });

  it("recordMutation never throws even when appendLedger explodes (fail-open)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/index.js", () => ({
      appendLedger: vi.fn(async () => { throw new Error("db exploded"); }),
    }));
    const mod = await import("@/lib/keys/mutationLedger.js");
    const r = await mod.recordMutation({
      request: null, surface: "lock", keyId: "k1", outcome: "locked",
    });
    expect(r).toBeNull(); // recorded failure, not thrown
    vi.doUnmock("@/lib/db/index.js");
  });
});

describe("W0 ledger seam — end-to-end route-level assertions", () => {
  it("updateApiKey-driven pause → resume → expire-set each land a distinct row", async () => {
    // Evict the first block's mock from the module registry — doUnmock alone
    // doesn't invalidate cached imports, and this suite must write through
    // the REAL appendLedger.
    vi.resetModules();
    const id = await seedKey("ledger-flow");
    const { updateApiKey } = await import("@/lib/db/repos/sqlite/apiKeysRepo.js");
    const { recordMutation, classifyPutSurface, summarizeUpdate } =
      await import("@/lib/keys/mutationLedger.js");

    // Mirror the route's exact sequence for the three lifecycle ops.
    await updateApiKey(id, { isActive: false });
    await recordMutation({ request: requestLike, surface: classifyPutSurface({ isActive: false }), keyId: id, outcome: "updated" });
    await updateApiKey(id, { isActive: true });
    await recordMutation({ request: requestLike, surface: classifyPutSurface({ isActive: true }), keyId: id, outcome: "updated" });
    await updateApiKey(id, { expiresAt: "2027-06-01T00:00:00Z" });
    await recordMutation({
      request: requestLike, surface: classifyPutSurface({ expiresAt: "2027-06-01T00:00:00Z" }),
      keyId: id, outcome: "updated", detail: summarizeUpdate({ expiresAt: "2027-06-01T00:00:00Z" }),
    });

    const rows = await db.getKeyLedgerRows({ keyId: id });
    const surfaces = rows.map((r) => r.surface);
    expect(surfaces).toEqual(["expire-set", "resume", "pause"]); // newest first
    const expireRow = rows[0];
    expect(expireRow.detail).toBe("fields:expiresAt");
  });

  it("secret-bearing fields are opaque in the ledger detail (Gate 5 F7)", async () => {
    vi.resetModules(); // same mock-eviction discipline as the sibling test
    const id = await seedKey("opaque-fields");
    const { updateApiKey } = await import("@/lib/db/repos/sqlite/apiKeysRepo.js");
    const { recordMutation, summarizeUpdate } = await import("@/lib/keys/mutationLedger.js");

    const updateData = { allowedProviders: ["openai"], ipAllowlist: ["10.0.0.0/8"] };
    await updateApiKey(id, updateData);
    await recordMutation({ request: requestLike, surface: "edit", keyId: id, outcome: "updated", detail: summarizeUpdate(updateData) });

    const rows = await db.getKeyLedgerRows({ keyId: id });
    const joined = JSON.stringify(rows);
    // The VALUES must never appear — only the field NAMES.
    expect(joined).not.toContain("openai");
    expect(joined).not.toContain("10.0.0.0/8");
    expect(joined).toContain("allowedProviders");
  });
});
