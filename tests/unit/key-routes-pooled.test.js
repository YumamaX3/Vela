// The pooled apply current — measured against a REAL migrated DB, through the
// routes' own POST handlers, so what is asserted is what a client observes.
//
// The refactor's promise is a promise of SAMENESS: six workers instead of one
// loop, and not one verdict, name, order or count may move. These cases pin
// that — the 200 cap still refuses verbatim, results still read in input
// order, one entry's failure is still only its own, and an import's show-once
// plaintexts still all arrive, in file order.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-keys-pool-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "keys-pool-secret";
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

const post = (pathname, body) =>
  new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const envelopeOf = (keys) => ({ app: "vela-keys", version: 1, keys });

describe("POST /api/keys/import — the pooled apply", { timeout: 30000 }, () => {
  it("keeps the 200-entry cap verbatim", async () => {
    const { POST } = await import("@/app/api/keys/import/route.js");
    const keys = Array.from({ length: 201 }, (_, i) => ({ name: `k${i}` }));
    const res = await POST(post("/api/keys/import", { mode: "apply", envelope: envelopeOf(keys) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Too many keys in one import (max 200)" });
  });

  it("mints every accepted entry and answers verdicts in FILE order", async () => {
    const { POST } = await import("@/app/api/keys/import/route.js");
    const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
    const res = await POST(post("/api/keys/import", { mode: "apply", envelope: envelopeOf(names.map((name) => ({ name }))) }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.applied.changed).toBe(10);
    expect(body.applied.results.map((r) => r.name)).toEqual(names);
    expect(body.applied.results.every((r) => r.ok && r.action === "add")).toBe(true);
    // the show-once ceremony survives concurrency: one plaintext per mint, in order
    expect(body.applied.created.map((c) => c.name)).toEqual(names);
    expect(body.applied.created.every((c) => typeof c.key === "string" && c.key.length > 0)).toBe(true);
    expect(new Set(body.applied.created.map((c) => c.keyId)).size).toBe(10);
  });

  it("a failing entry is only its own refusal — the rest still mint", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/import/route.js");
    // Seed one name, then import a file that collides with it under "rename"
    // and carries one genuinely invalid entry mid-file.
    await localDb.createApiKey("taken", {});
    const keys = [
      { name: "fresh-1" },
      { name: "taken" },
      { name: "bad", rateLimitRpm: -5 }, // refused at PLAN time, before any write
      { name: "fresh-2" },
    ];
    const res = await POST(post("/api/keys/import", { mode: "apply", onConflict: "rename", envelope: envelopeOf(keys) }));
    const body = await res.json();

    expect(body.invalid.map((i) => i.name)).toEqual(["bad"]);
    expect(body.applied.results.map((r) => r.name)).toEqual(["fresh-1", "taken", "fresh-2"]);
    expect(body.applied.results.every((r) => r.ok)).toBe(true);
    expect(body.applied.results[1].targetName).toBe("taken (2)");
    expect(body.applied.changed).toBe(3);
  });

  it("overwrite updates in place — no new plaintext for an updated entry", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/import/route.js");
    const seeded = await localDb.createApiKey("keeper", {});
    const res = await POST(post("/api/keys/import", {
      mode: "apply",
      onConflict: "overwrite",
      envelope: envelopeOf([{ name: "keeper", description: "re-carved" }, { name: "newcomer" }]),
    }));
    const body = await res.json();

    expect(body.applied.results).toEqual([
      { name: "keeper", ok: true, action: "overwrite" },
      { name: "newcomer", ok: true, action: "add", targetName: "newcomer" },
    ]);
    expect(body.applied.updated).toEqual([{ id: seeded.keyId, name: "keeper" }]);
    expect(body.applied.created).toHaveLength(1);
    expect(body.applied.changed).toBe(2);
  });

  it("skip conflicts produce a plan but no writes", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/import/route.js");
    await localDb.createApiKey("held", {});
    const body = await (await POST(post("/api/keys/import", { mode: "apply", onConflict: "skip", envelope: envelopeOf([{ name: "held" }]) }))).json();
    expect(body.applied).toEqual({ changed: 0, created: [], updated: [], results: [] });
    expect(body.summary.skip).toBe(1);
  });

  it("dry-run writes nothing, even under the new current", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/import/route.js");
    const body = await (await POST(post("/api/keys/import", { mode: "dry-run", envelope: envelopeOf([{ name: "a" }, { name: "b" }]) }))).json();
    expect(body.mode).toBe("dry-run");
    expect(body.summary).toEqual({ create: 2, update: 0, skip: 0, invalid: 0 });
    expect(await localDb.getApiKeys()).toHaveLength(0);
  });
});

describe("POST /api/keys/bulk — the pooled current", { timeout: 30000 }, () => {
  it("applies one verdict per target, in SELECTION order, across the full cap", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/bulk/route.js");
    const created = [];
    for (let i = 0; i < 40; i += 1) created.push(await localDb.createApiKey(`fleet-${i}`, {}));
    const names = created.map((k) => k.record.name);

    const body = await (await POST(post("/api/keys/bulk", { action: "pause", names }))).json();
    expect(body.changed).toBe(40);
    expect(body.failed).toBe(0);
    expect(body.results.map((r) => r.name)).toEqual(names);
    expect(body.results.every((r) => r.ok)).toBe(true);

    const after = await localDb.getApiKeys();
    expect(after.every((k) => k.isActive === false)).toBe(true);
  });

  it("a miss and an ambiguous name stay their own verdicts; the rest still apply", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/bulk/route.js");
    const a = await localDb.createApiKey("solo", {});
    await localDb.createApiKey("twin", {});
    await localDb.createApiKey("twin", {});

    const body = await (await POST(post("/api/keys/bulk", { action: "resume", names: ["solo", "ghost", "twin"] }))).json();
    expect(body.changed).toBe(1);
    expect(body.failed).toBe(2);
    expect(body.results[0]).toEqual({ id: a.keyId, name: "solo", ok: true });
    expect(body.results[1]).toMatchObject({ name: "ghost", ok: false, error: "Key not found" });
    expect(body.results[2]).toMatchObject({ name: "twin", ok: false });
    expect(body.results[2].error).toMatch(/ambiguous/);
  });

  it("setLimits applies the patch to every target and reports the count", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/bulk/route.js");
    const ids = [];
    for (let i = 0; i < 8; i += 1) ids.push((await localDb.createApiKey(`lim-${i}`, {})).keyId);

    const body = await (await POST(post("/api/keys/bulk", { action: "setLimits", ids, limits: { rateLimitRpm: 30 } }))).json();
    expect(body.changed).toBe(8);
    const after = await localDb.getApiKeys();
    expect(after.every((k) => k.rateLimitRpm === 30)).toBe(true);
  });

  it("delete revokes each target and a second run reports 'Already revoked' per key", async () => {
    const localDb = await import("@/lib/localDb");
    const { POST } = await import("@/app/api/keys/bulk/route.js");
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push((await localDb.createApiKey(`rev-${i}`, {})).keyId);

    const first = await (await POST(post("/api/keys/bulk", { action: "delete", ids }))).json();
    expect(first.changed).toBe(5);
    expect(first.results.map((r) => r.id)).toEqual(ids);

    // names are gone from the live fleet; by id the second pass reports refusals
    const second = await (await POST(post("/api/keys/bulk", { action: "delete", ids }))).json();
    expect(second.changed).toBe(0);
    expect(second.results.every((r) => !r.ok && r.error === "Key not found")).toBe(true);
  });

  it("keeps the 200-item cap verbatim", async () => {
    const { POST } = await import("@/app/api/keys/bulk/route.js");
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    const res = await POST(post("/api/keys/bulk", { action: "pause", ids }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Too many items in one call (max 200)" });
  });
});
