// Database maintenance sub-routes — Go path parity.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};
const CLI = { "x-vela-cli-token": "local" };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-dbsub-"));
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

describe("database sub-routes", () => {
  it("serves stats, prune-usage dry run, vacuum and prune to a CLI caller", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const stats = await import("@/app/api/settings/database/stats/route.js");
    const statsRes = await stats.GET(new Request("http://localhost/api/settings/database/stats", { headers: CLI }));
    expect(statsRes.status).toBe(200);
    expect(await statsRes.json()).toHaveProperty("file");

    const pruneUsage = await import("@/app/api/settings/database/prune-usage/route.js");
    const dry = await pruneUsage.POST(new Request("http://localhost/api/settings/database/prune-usage", {
      method: "POST", headers: { ...CLI, "content-type": "application/json" },
      body: JSON.stringify({ days: 30, dryRun: true }),
    }));
    expect(dry.status).toBe(200);
    expect(await dry.json()).toMatchObject({ dryRun: true });

    const vacuum = await import("@/app/api/settings/database/vacuum/route.js");
    const vac = await vacuum.POST(new Request("http://localhost/api/settings/database/vacuum", {
      method: "POST", headers: CLI, body: "{}",
    }));
    expect(vac.status).toBe(200);
    expect(await vac.json()).toHaveProperty("reclaimedBytes");

    const prune = await import("@/app/api/settings/database/prune/route.js");
    const pruned = await prune.POST(new Request("http://localhost/api/settings/database/prune", {
      method: "POST", headers: { ...CLI, "content-type": "application/json" },
      body: JSON.stringify({ days: 7 }),
    }));
    expect(pruned.status).toBe(200);
    expect(await pruned.json()).toMatchObject({ success: true, retentionDays: 7 });
  });

  it("refuses an unauthenticated caller", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const stats = await import("@/app/api/settings/database/stats/route.js");
    const res = await stats.GET(new Request("http://localhost/api/settings/database/stats"));
    expect(res.status).toBe(401);
  });
});
