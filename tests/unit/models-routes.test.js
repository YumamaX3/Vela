// Models caps + deprecations — ported from 9router-go.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-models-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.MODE = process.env.VELA_DB_MODE;
  process.env.DATA_DIR = tempDir;
  delete process.env.VELA_DB_MODE;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET /api/models/caps", () => {
  it("requires a provider and returns the capability matrix", async () => {
    const { GET } = await import("@/app/api/models/caps/route.js");
    const missing = await GET(new Request("http://localhost/api/models/caps"));
    expect(missing.status).toBe(400);

    const res = await GET(new Request("http://localhost/api/models/caps?provider=claude"));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.provider).toBe("claude");
    expect(payload.caps).toBeTypeOf("object");
    const ids = Object.keys(payload.caps);
    expect(ids.length).toBeGreaterThan(0);
    expect(payload.caps[ids[0]]).toHaveProperty("contextWindow");
    expect(payload.caps[ids[0]]).toHaveProperty("vision");
  });
});

describe("model deprecations", () => {
  it("records, lists, scopes, retains and clears", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const repo = await import("@/lib/db/repos/deprecationsRepo.js");

    await repo.recordModelDeprecation({ provider: "deepseek", model: "old", status: "retired", note: "410 upstream" });
    await repo.recordModelDeprecation({ provider: "groq", model: "gone", status: "removed" });

    const all = await repo.listModelDeprecations();
    expect(Object.keys(all).sort()).toEqual(["deepseek/old", "groq/gone"]);
    const scoped = await repo.listModelDeprecations("deepseek");
    expect(Object.keys(scoped)).toEqual(["deepseek/old"]);
    expect(await repo.getModelDeprecation("deepseek", "old")).toMatchObject({ provider: "deepseek", status: "retired" });

    // A live sighting clears only models the catalogue actually contains.
    expect(await repo.retainLiveModels("deepseek", new Set(["deepseek/other"]))).toBe(0);
    expect(await repo.retainLiveModels("deepseek", new Set(["deepseek/old"]))).toBe(1);
    expect(await repo.getModelDeprecation("deepseek", "old")).toBeNull();
  });

  it("rejects a record without provider, model or a known status", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const repo = await import("@/lib/db/repos/deprecationsRepo.js");
    await expect(repo.recordModelDeprecation({ provider: "p", model: "m" })).rejects.toThrow(/status/);
    await expect(repo.recordModelDeprecation({ provider: "p", model: "m", status: "alive" })).rejects.toThrow(/status/);
  });

  it("serves the dashboard route with an empty and a populated map", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const repo = await import("@/lib/db/repos/deprecationsRepo.js");
    const { GET } = await import("@/app/api/models/deprecations/route.js");

    const empty = await (await GET(new Request("http://localhost/api/models/deprecations"))).json();
    expect(empty).toEqual({ provider: "", deprecations: {} });

    await repo.recordModelDeprecation({ provider: "p", model: "m", status: "deprecated" });
    const payload = await (await GET(new Request("http://localhost/api/models/deprecations?provider=p"))).json();
    expect(payload.provider).toBe("p");
    expect(payload.deprecations["p/m"]).toMatchObject({ status: "deprecated" });
  });
});
