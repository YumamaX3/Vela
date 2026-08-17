// Usage Observatory W3-A — the /api/usage/budgets contract test.
//
// Covers, against a real sqlite twin (route handlers invoked directly — the
// dashboardGuard middleware covers "/api/usage" at the edge, so route-level
// tests pin the handler contract, not the middleware):
//   • GET list + GET ?id= single (404 on absent)
//   • POST create → 201; honest 400s per frozen vocabulary; 409 on MAX_BUDGETS
//   • PATCH ?id= partial update, including the id-changing scope/subject move
//   • DELETE ?id= → removed:true, then 404
//   • Malformed JSON body → 400, never a 500
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w3a-api-"));
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
  return import("@/app/api/usage/budgets/route.js");
}

function jsonReq(method, qs = "", body = undefined) {
  const init = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://localhost/api/usage/budgets${qs ? `?${qs}` : ""}`, init);
}

describe("W3-A budgets API — read surface", () => {
  it("GET lists definitions (empty world → [])", async () => {
    const r = await route();
    const res = await r.GET(jsonReq("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).budgets).toEqual([]);
  });

  it("GET ?id= returns one definition; 404 when absent", async () => {
    const r = await route();
    await r.POST(jsonReq("POST", "", { scope: "gateway", window: "day", tokenCap: 5 }));
    const hit = await (await r.GET(jsonReq("GET", "id=gateway:*"))).json();
    expect(hit.budget.tokenCap).toBe(5);
    const miss = await r.GET(jsonReq("GET", "id=key:nope"));
    expect(miss.status).toBe(404);
  });
});

describe("W3-A budgets API — write surface", () => {
  it("POST creates a budget → 201 with normalized def", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", { scope: "key", subject: "k1", window: "month", spendCapCents: 4200 }));
    expect(res.status).toBe(201);
    const { budget } = await res.json();
    expect(budget.id).toBe("key:k1");
    expect(budget.thresholds).toEqual([50, 80, 100]);
  });

  it("POST invalid input → honest 400 with the error list", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", { scope: "gateway", window: "year", tokenCap: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors.join(" ")).toMatch(/window must be one of/);
  });

  it("POST overlong subject → honest 400", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", { scope: "key", subject: "x".repeat(300), window: "day", tokenCap: 1 }));
    expect(res.status).toBe(400);
    expect((await res.json()).errors.join(" ")).toMatch(/256 characters/);
  });

  it("POST malformed JSON body → 400, never 500", async () => {
    const r = await route();
    const res = await r.POST(jsonReq("POST", "", "{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/);
  });

  it("PATCH changes caps in place", async () => {
    const r = await route();
    await r.POST(jsonReq("POST", "", { scope: "gateway", window: "day", tokenCap: 100 }));
    const res = await r.PATCH(jsonReq("PATCH", "id=gateway:*", { tokenCap: 999 }));
    expect(res.status).toBe(200);
    const { budget } = await res.json();
    expect(budget.tokenCap).toBe(999);
    expect(budget.window).toBe("day"); // untouched field preserved
  });

  it("PATCH scope/subject moves the definition to a new id", async () => {
    const r = await route();
    await r.POST(jsonReq("POST", "", { scope: "gateway", window: "day", tokenCap: 7 }));
    const res = await r.PATCH(jsonReq("PATCH", "id=gateway:*", { scope: "model", subject: "openai/gpt-4o" }));
    expect(res.status).toBe(200);
    const { budget } = await res.json();
    expect(budget.id).toBe("model:openai/gpt-4o");
    // Old id is gone, new id resolves — exactly one definition remains.
    expect((await r.GET(jsonReq("GET", "id=gateway:*"))).status).toBe(404);
    const list = await (await r.GET(jsonReq("GET"))).json();
    expect(list.budgets.length).toBe(1);
  });

  it("PATCH absent id → 404; DELETE removes then 404", async () => {
    const r = await route();
    expect((await r.PATCH(jsonReq("PATCH", "id=key:ghost", { tokenCap: 1 }))).status).toBe(404);
    await r.POST(jsonReq("POST", "", { scope: "gateway", window: "day", spendCapCents: 50 }));
    const del = await r.DELETE(jsonReq("DELETE", "id=gateway:*"));
    expect((await del.json()).removed).toBe(true);
    expect((await r.DELETE(jsonReq("DELETE", "id=gateway:*"))).status).toBe(404);
    expect((await r.PATCH(jsonReq("PATCH", "id=", {}))).status).toBe(400); // missing id
  });

  it("MAX_BUDGETS rail → 409 on the create that crosses the cap", async () => {
    const r = await route();
    // Build to the cap with key budgets (gateway:* is one shared id).
    const { MAX_BUDGETS } = await import("@/lib/budgetDef.js");
    for (let i = 0; i < MAX_BUDGETS; i++) {
      const res = await r.POST(jsonReq("POST", "", { scope: "key", subject: `k${i}`, window: "day", tokenCap: 1 }));
      expect(res.status).toBe(201);
    }
    const over = await r.POST(jsonReq("POST", "", { scope: "key", subject: "k-overflow", window: "day", tokenCap: 1 }));
    expect(over.status).toBe(409);
    expect((await over.json()).error).toMatch(/budget limit reached/);
    // An UPDATE of an existing id still succeeds past the cap (replace ≠ grow).
    const upd = await r.PATCH(jsonReq("PATCH", "id=key:k0", { tokenCap: 2 }));
    expect(upd.status).toBe(200);
  });
});
