// Test covenant: policy-kinds migration 027 + the script shape through the
// POLICY STORE and the POLICIES ROUTES.
//
// The dispatch seam is proven apart (injector-scripts / guardrails-script-chat-core).
// This suite proves the two doors an operator uses before dispatch ever runs:
//
//   M1. 027 is additive — `kind`/`turns` exist, are nullable, default to
//       "system" behavior, and the chain's latest version agrees with
//       SCHEMA_VERSION
//   M2. the store round-trips a script policy and validates its turns
//   M3. the policies route accepts the script shape (flat and in `config`)
//   M4. the settings route validates userInjectors — a malformed script is a
//       400, a sound system injector is unchanged
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

let tempDir;
let driverRef;
let policiesRoute;
let policyRoute;
let settingsRoute;

function post(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(url, body) {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

const TURNS = [
  { role: "user", content: "Speak like a pirate." },
  { role: "assistant", content: "Arrr." },
];

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-policy-kinds-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  driverRef = await import("@/lib/db/driver.js");
  await driverRef.getAdapter();
  policiesRoute = await import("@/app/api/guardrails/policies/route.js");
  policyRoute = await import("@/app/api/guardrails/policies/[id]/route.js");
  settingsRoute = await import("@/app/api/settings/route.js");
});

afterAll(() => {
  try { driverRef?.resetAdapter?.(); } catch { /* closed */ }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (process.env.DATA_DIR === tempDir) delete process.env.DATA_DIR;
});

describe("M1 — migration 027 is additive", () => {
  it("the chain's latest version agrees with SCHEMA_VERSION", async () => {
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    expect(latestVersion()).toBe(SCHEMA_VERSION);
    expect(latestVersion()).toBeGreaterThanOrEqual(27);
  });

  it("guardrailPolicies carries kind and turns, nullable with no default", async () => {
    const db = await driverRef.getAdapter();
    const cols = db.all(`PRAGMA table_info(guardrailPolicies)`);
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const col of ["kind", "turns"]) {
      expect(byName.has(col)).toBe(true);
      expect(byName.get(col).dflt_value).toBeNull();
      expect(byName.get(col).notnull).toBe(0);
    }
    // 026's columns are untouched by 027.
    expect(byName.has("prompt")).toBe(true);
    expect(byName.has("promptPosition")).toBe(true);
  });

  it("re-running 027 up() is idempotent", async () => {
    const db = await driverRef.getAdapter();
    const { default: m027 } = await import("@/lib/db/migrations/027-policy-kinds.js");
    expect(() => m027.up(db)).not.toThrow();
    const cols = db.all(`PRAGMA table_info(guardrailPolicies)`).map((c) => c.name);
    expect(cols).toContain("kind");
    expect(cols).toContain("turns");
  });

  it("the TABLES mirror declares both columns (fresh-install source)", async () => {
    const { TABLES } = await import("@/lib/db/schema.js");
    expect(TABLES.guardrailPolicies.columns.kind).toBe("TEXT");
    expect(TABLES.guardrailPolicies.columns.turns).toBe("TEXT");
  });
});

describe("M2 — the store round-trips and validates a script policy", () => {
  it("a system policy stays a system policy (nil kind reads as 'system')", async () => {
    const store = await import("@/lib/guardrails/policyStore.js");
    const { result, policy } = await store.createPolicy({ name: "plain", scope: "global", detectors: ["pii"], action: "block" }).then((r) => ({ result: r, policy: r.policy }));
    expect(result.ok).toBe(true);
    expect(policy.kind).toBe("system");
    expect(policy.turns).toBeNull();
    const back = await store.getPolicy(policy.id);
    expect(back.kind).toBe("system");
  });

  it("a script policy round-trips its turns in order", async () => {
    const store = await import("@/lib/guardrails/policyStore.js");
    const r = await store.createPolicy({ name: "pirate", scope: "global", direction: "inbound", detectors: [], kind: "script", turns: TURNS });
    expect(r.ok).toBe(true);
    const back = await store.getPolicy(r.policy.id);
    expect(back.kind).toBe("script");
    expect(back.turns).toEqual(TURNS);
  });

  it("rejects a script with no turns and one with a system-role turn", async () => {
    const store = await import("@/lib/guardrails/policyStore.js");
    expect((await store.createPolicy({ name: "empty", kind: "script", turns: [] })).ok).toBe(false);
    const withSystem = await store.createPolicy({ name: "sys", kind: "script", turns: [{ role: "system", content: "x" }] });
    expect(withSystem.ok).toBe(false);
    expect(withSystem.errors.join(" ")).toMatch(/user or assistant/);
  });

  it("an update can switch a system policy to a script without touching its detectors", async () => {
    const store = await import("@/lib/guardrails/policyStore.js");
    const r = await store.createPolicy({ name: "flip", scope: "global", detectors: ["pii"], action: "mask" });
    const u = await store.updatePolicy(r.policy.id, { kind: "script", turns: TURNS });
    expect(u.ok).toBe(true);
    expect(u.policy.kind).toBe("script");
    expect(u.policy.turns).toEqual(TURNS);
    expect(u.policy.detectors).toEqual(["pii"]);
  });
});

describe("M3 — the policies route accepts the script shape", () => {
  it("POST with a flat script body returns a script policy", async () => {
    const r = await json(await policiesRoute.POST(post("http://x/api/guardrails/policies", {
      name: "route-script", scope: "global", direction: "inbound", detectors: [], kind: "script", turns: TURNS,
    })));
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe("script");
    expect(r.body.turns).toEqual(TURNS);
  });

  it("POST accepts kind/turns inside the config crate (9router-go form)", async () => {
    const r = await json(await policiesRoute.POST(post("http://x/api/guardrails/policies", {
      name: "config-script", scope: "global", detectors: [],
      config: { kind: "script", turns: TURNS },
    })));
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe("script");
  });

  it("POST rejects a malformed script with 400", async () => {
    const r = await json(await policiesRoute.POST(post("http://x/api/guardrails/policies", {
      name: "bad", scope: "global", kind: "script", turns: [],
    })));
    expect(r.status).toBe(400);
  });

  it("PATCH can turn a stored policy into a script", async () => {
    const created = await json(await policiesRoute.POST(post("http://x/api/guardrails/policies", {
      name: "to-flip", scope: "global", detectors: [],
    })));
    const r = await json(await policyRoute.PATCH(patch(`http://x/api/guardrails/policies/${created.body.id}`, {
      kind: "script", turns: TURNS,
    }), { params: Promise.resolve({ id: created.body.id }) }));
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("script");
    expect(r.body.turns).toEqual(TURNS);
  });
});

describe("M4 — the settings route validates userInjectors", () => {
  it("accepts a sound script injector", async () => {
    const r = await json(await settingsRoute.PATCH(patch("http://x/api/settings", {
      userInjectors: [{ name: "pirate", kind: "script", enabled: true, turns: TURNS }],
    })));
    expect(r.status).toBe(200);
  });

  it("refuses a malformed script injector with 400 and the reason", async () => {
    const r = await json(await settingsRoute.PATCH(patch("http://x/api/settings", {
      userInjectors: [{ name: "bad", kind: "script", turns: [] }],
    })));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least one turn/);
  });

  it("leaves the plain system injector unchanged", async () => {
    const r = await json(await settingsRoute.PATCH(patch("http://x/api/settings", {
      userInjectors: [{ name: "plain", prompt: "Be brief.", position: "append", applyTo: "llm" }],
    })));
    expect(r.status).toBe(200);
    const get = await json(await settingsRoute.GET());
    const saved = get.body.userInjectors.find((i) => i.name === "plain");
    expect(saved.prompt).toBe("Be brief.");
    expect(saved.kind === undefined || saved.kind === "system").toBe(true);
  });

  it("refuses a system injector with no prompt", async () => {
    const r = await json(await settingsRoute.PATCH(patch("http://x/api/settings", {
      userInjectors: [{ name: "empty-system" }],
    })));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/prompt is required/);
  });
});
