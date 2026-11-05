// Plans routes — the HTTP edge over the plans registry.
//
// WHY THIS FILE EXISTS: .gitignore's `plans/` rule was a bare directory name,
// so it ALSO ignored src/app/api/plans/** — the routes' own source. A fresh
// clone shipped the dashboard's /api/plans imports without their handlers
// (the dev harbor answered 500 on /api/plans until the routes were re-added
// by hand). The ignore rule is now anchored (/plans/); this suite is the
// standing proof the three handlers answer for themselves at the wire.
//
// The registry layer (create/list/update/inherit) is pinned against a real
// scratch DB by plans-registry.test.js; this file pins the HTTP CONTRACT
// only — status codes, error shapes, and the 409 duplicate guard — with the
// repo mocked at the seam, so no handler body is left unproven.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) =>
      new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));
const plansRepo = vi.hoisted(() => ({
  listPlans: vi.fn(),
  getPlan: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
  countPlanKeys: vi.fn(),
}));
vi.mock("@/lib/db/repos/plansRepo.js", () => plansRepo);

const validator = vi.hoisted(() => ({ validatePlan: vi.fn() }));
vi.mock("@/lib/plans.js", () => validator);

const { GET, POST } = await import("@/app/api/plans/route.js");
const { GET: getOne, PUT, DELETE } = await import("@/app/api/plans/[id]/route.js");
const { GET: countKeys } = await import("@/app/api/plans/[id]/keys/route.js");

beforeEach(() => {
  vi.clearAllMocks();
  plansRepo.listPlans.mockResolvedValue([]);
});

// ── GET /api/plans ─────────────────────────────────────────────────────────
describe("GET /api/plans — the fleet's plan roster", () => {
  it("answers the list with the repo's own rows", async () => {
    plansRepo.listPlans.mockResolvedValue([{ id: "p1", name: "Team" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plans: [{ id: "p1", name: "Team" }] });
  });

  it("a thrown dependency is a LOUD 500 — never a zeroed roster", async () => {
    plansRepo.listPlans.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to list plans");
  });
});

// ── POST /api/plans ────────────────────────────────────────────────────────
describe("POST /api/plans — create one template", () => {
  it("a body the validator refuses is a 400 carrying its reasons", async () => {
    validator.validatePlan.mockReturnValue({ ok: false, errors: ["name required"] });
    const res = await POST(new Request("http://t/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual(["name required"]);
  });

  it("a name that already exists is a 409 — the registry's own law", async () => {
    validator.validatePlan.mockReturnValue({ ok: true, plan: { name: "Team" } });
    plansRepo.listPlans.mockResolvedValue([{ id: "p1", name: "team" }]);
    const res = await POST(new Request("http://t/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/i);
  });

  it("a valid new template is a 201 with the repo's row", async () => {
    validator.validatePlan.mockReturnValue({ ok: true, plan: { name: "Fresh" } });
    plansRepo.listPlans.mockResolvedValue([]);
    plansRepo.createPlan.mockResolvedValue({ id: "p2", name: "Fresh" });
    const res = await POST(new Request("http://t/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "p2", name: "Fresh" });
  });
});

// ── GET/PUT/DELETE /api/plans/{id} ─────────────────────────────────────────
describe("the one-plan routes", () => {
  it("an unknown id is a 404 — not an empty 200", async () => {
    plansRepo.getPlan.mockResolvedValue(null);
    const res = await getOne(new Request("http://t/api/plans/nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("a known id answers its row", async () => {
    plansRepo.getPlan.mockResolvedValue({ id: "p1", name: "Team" });
    const res = await getOne(new Request("http://t/api/plans/p1"), { params: Promise.resolve({ id: "p1" }) });
    expect((await res.json()).name).toBe("Team");
  });

  it("PUT refuses a name another plan already owns — 409, and the stored row is untouched", async () => {
    plansRepo.getPlan.mockResolvedValue({ id: "p1", name: "Team" });
    plansRepo.listPlans.mockResolvedValue([{ id: "p2", name: "Squad" }]);
    validator.validatePlan.mockReturnValue({ ok: true, plan: { name: "squad" } });
    const res = await PUT(new Request("http://t/api/plans/p1", { method: "PUT", body: "{}" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/i);
    expect(plansRepo.updatePlan).not.toHaveBeenCalled();
  });

  it("PUT merges a valid body through the validator's base — the omitted-field law", async () => {
    plansRepo.getPlan.mockResolvedValue({ id: "p1", name: "Team", limitTokens: 10 });
    plansRepo.listPlans.mockResolvedValue([{ id: "p1", name: "Team" }]);
    validator.validatePlan.mockReturnValue({ ok: true, plan: { id: "p1", limitTokens: 20 } });
    plansRepo.updatePlan.mockResolvedValue({ id: "p1", name: "Team", limitTokens: 20 });
    const res = await PUT(new Request("http://t/api/plans/p1", { method: "PUT", body: "{}" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    // the EXISTING row is the validator's base — that is what keeps omitted fields
    expect(validator.validatePlan).toHaveBeenCalledWith({}, { id: "p1", name: "Team", limitTokens: 10 });
    expect(await res.json()).toEqual({ id: "p1", name: "Team", limitTokens: 20 });
  });

  it("DELETE refuses while any live key inherits the plan — 409 naming the count", async () => {
    plansRepo.getPlan.mockResolvedValue({ id: "p1" });
    plansRepo.countPlanKeys.mockResolvedValue(2);
    const res = await DELETE(new Request("http://t/api/plans/p1", { method: "DELETE" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Plan is inherited by 2 keys; reassign them before deleting", keys: 2 });
  });

  it("DELETE succeeds once no key inherits it", async () => {
    plansRepo.getPlan.mockResolvedValue({ id: "p1" });
    plansRepo.countPlanKeys.mockResolvedValue(0);
    const res = await DELETE(new Request("http://t/api/plans/p1", { method: "DELETE" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("the keys sub-route counts live keys for a real plan and 404s a missing one", async () => {
    plansRepo.getPlan.mockResolvedValue({ id: "p1" });
    plansRepo.countPlanKeys.mockResolvedValue(3);
    const ok = await countKeys(new Request("http://t/api/plans/p1/keys"), { params: Promise.resolve({ id: "p1" }) });
    expect(await ok.json()).toEqual({ id: "p1", keys: 3 });

    plansRepo.getPlan.mockResolvedValue(null);
    const missing = await countKeys(new Request("http://t/api/plans/x/keys"), { params: Promise.resolve({ id: "x" }) });
    expect(missing.status).toBe(404);
  });

  it("PUT and DELETE exist as handlers (shape pinned by the registry suite)", async () => {
    expect(typeof PUT).toBe("function");
    expect(typeof DELETE).toBe("function");
  });
});
