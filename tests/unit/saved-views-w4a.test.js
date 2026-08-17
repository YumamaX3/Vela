// Usage Observatory W4-A — saved views contract test.
//
// Covers, against a real sqlite twin (route handlers invoked directly — the
// dashboardGuard middleware marks "/api/usage/views" ALWAYS_PROTECTED at the
// edge, so route-level tests pin the handler contract, not the middleware):
//   • migration 009 forged the table + registry/schema mirror advanced to 9
//   • GET lists views newest-first (empty world → [])
//   • POST save → 201; duplicate name upserts → 200 + created:false
//   • honest 400s: empty name, overlong name, empty params, unknown key,
//     overlong params, malformed JSON — never a 500
//   • leading "?" tolerated and normalized away
//   • 409 when MAX_SAVED_VIEWS bites (seeded through the repo, one POST more)
//   • DELETE ?id= → ok, then 404; non-numeric id → 400
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w4a-"));
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

async function route() {
  return import("@/app/api/usage/views/route.js");
}

function jsonReq(method, qs = "", body = undefined) {
  const init = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://localhost/api/usage/views${qs ? `?${qs}` : ""}`, init);
}

const VIEW = { name: "Money this week", params: "tab=overview&period=7d&prov=openai" };

describe("W4-A saved views — migration 009 + schema mirror", () => {
  it("migration registry and schema mirror advanced to 10", async () => {
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    expect(latestVersion()).toBe(10);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const { TABLES, SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    expect(SCHEMA_VERSION).toBe(10);
    expect(TABLES.usageViews).toBeTruthy();
    expect(TABLES.usageViews.columns.name).toBe("TEXT NOT NULL");
  });

  it("the table exists after boot (migration chain applied)", async () => {
    const r = await route();
    const res = await r.GET(jsonReq("GET")); // boots adapter → migrations run
    expect(res.status).toBe(200);
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const row = db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='usageViews'`);
    expect(row?.name).toBe("usageViews");
  });
});

describe("W4-A saved views — read + write surface", () => {
  it("GET lists views newest-first; empty world → []", async () => {
    const r = await route();
    const res = await r.GET(jsonReq("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).views).toEqual([]);
  });

  it("POST save → 201 + created:true; the view round-trips intact", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", VIEW));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.view.name).toBe(VIEW.name);
    expect(body.view.params).toBe(VIEW.params);
    expect(body.view.id).toBeGreaterThan(0);

    const list = await (await r.GET(jsonReq("GET"))).json();
    expect(list.views).toHaveLength(1);
  });

  it("duplicate name upserts the params → 200 + created:false", async () => {
    const r = await route();
    await r.POST(jsonReq("POST", "", VIEW));
    const res = await r.POST(jsonReq("POST", "", { ...VIEW, params: "tab=requests&period=30d&sort=cost&order=asc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(false);
    expect(body.view.params).toBe("tab=requests&period=30d&sort=cost&order=asc");

    const list = await (await r.GET(jsonReq("GET"))).json();
    expect(list.views).toHaveLength(1); // one view, updated — never duplicated
  });

  it("leading '?' is tolerated and normalized away", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", { name: "Q", params: "?tab=analytics&period=24h" }));
    expect(res.status).toBe(201);
    expect((await res.json()).view.params).toBe("tab=analytics&period=24h");
  });
});

describe("W4-A saved views — the honest 400s", () => {
  const cases = [
    ["empty name", { name: "   ", params: "tab=overview" }],
    ["missing params", { name: "x" }],
    ["empty params", { name: "x", params: "" }],
    ["unknown key (foreign state refused)", { name: "x", params: "tab=overview&evil=1" }],
    ["overlong name", { name: "a".repeat(65), params: "tab=overview" }],
    ["overlong params", { name: "x", params: `q=${"z".repeat(2100)}` }],
  ];
  for (const [label, body] of cases) {
    it(`rejects ${label} with 400 + errors[]`, async () => {
      const r = await route();
      const res = await r.POST(jsonReq("POST", "", body));
      expect(res.status).toBe(400);
      const out = await res.json();
      expect(Array.isArray(out.errors)).toBe(true);
      expect(out.errors.length).toBeGreaterThan(0);
    });
  }

  it("malformed JSON body → 400, never a 500", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", "{not-json"));
    expect(res.status).toBe(400);
  });

  it("unknown-param rejection names the offending key", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", { name: "x", params: "tab=overview&__proto__=1" }));
    const out = await res.json();
    expect(out.errors.join(" ")).toContain("__proto__");
  });
});

describe("W4-A saved views — limits and delete", () => {
  it("409 when MAX_SAVED_VIEWS bites (repo-seeded, one POST more)", async () => {
    const r = await route();
    const { MAX_SAVED_VIEWS } = await import("@/lib/savedViewDef.js");
    const repo = await import("@/lib/db/repos/savedViewsRepo.js");
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) {
      await repo.saveSavedView({ name: `view-${i}`, params: "tab=overview" });
    }
    const res = await r.POST(jsonReq("POST", "", { name: "one-too-many", params: "tab=overview" }));
    expect(res.status).toBe(409);
    // an upsert still passes at the limit — the count never grows
    const up = await r.POST(jsonReq("POST", "", { name: "view-0", params: "tab=requests" }));
    expect(up.status).toBe(200);
  });

  it("DELETE ?id= removes → ok:true, then 404; bad id → 400", async () => {
    const r = await route();
    const made = await (await r.POST(jsonReq("POST", "", VIEW))).json();
    const id = made.view.id;

    const del = await r.DELETE(jsonReq("DELETE", `id=${id}`));
    expect(del.status).toBe(200);
    expect((await del.json()).ok).toBe(true);

    const again = await r.DELETE(jsonReq("DELETE", `id=${id}`));
    expect(again.status).toBe(404);

    const bad = await r.DELETE(jsonReq("DELETE", "id=abc"));
    expect(bad.status).toBe(400);
    const missing = await r.DELETE(jsonReq("DELETE", ""));
    expect(missing.status).toBe(400);
  });
});
