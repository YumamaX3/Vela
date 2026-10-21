// GUARDRAIL ROUTES — the HTTP surface, exercised through real Request objects
// against a real (temporary) database.
//
// The store is proven apart. What this suite proves is the wiring an operator
// touches: create → list → read → update → delete, plus the audit page and its
// limit guard. A route that shapes a payload wrongly is invisible to a store
// test and fatal to a dashboard.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let driverRef;
let policiesRoute;
let policyRoute;
let logsRoute;

function post(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-guardrail-routes-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  driverRef = await import("@/lib/db/driver.js");
  await driverRef.getAdapter();
  policiesRoute = await import("@/app/api/guardrails/policies/route.js");
  policyRoute = await import("@/app/api/guardrails/policies/[id]/route.js");
  logsRoute = await import("@/app/api/guardrails/logs/route.js");
});

afterAll(() => {
  try { driverRef?.resetAdapter?.(); } catch { /* closed */ }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("policy routes", () => {
  it("creates, lists, reads, updates and deletes a policy", async () => {
    const created = await json(await policiesRoute.POST(post(
      "http://localhost/api/guardrails/policies",
      { name: "Block PII", scope: "global", detectors: ["pii"], action: "block" },
    )));
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(id).toBeTruthy();
    expect(created.body.action).toBe("block");

    const listed = await json(await policiesRoute.GET(new Request("http://localhost/api/guardrails/policies")));
    expect(listed.status).toBe(200);
    expect(listed.body.map((p) => p.id)).toContain(id);

    const fetched = await json(await policyRoute.GET(new Request(`http://localhost/api/guardrails/policies/${id}`), {
      params: Promise.resolve({ id }),
    }));
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe("Block PII");

    const patched = await json(await policyRoute.PATCH(
      post(`http://localhost/api/guardrails/policies/${id}`, { action: "mask", priority: 7 }),
      { params: Promise.resolve({ id }) },
    ));
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ action: "mask", priority: 7 });

    const deleted = await json(await policyRoute.DELETE(
      new Request(`http://localhost/api/guardrails/policies/${id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id }) },
    ));
    expect(deleted.status).toBe(200);
    expect(deleted.body.id).toBe(id);

    const gone = await json(await policyRoute.GET(new Request(`http://localhost/api/guardrails/policies/${id}`), {
      params: Promise.resolve({ id }),
    }));
    expect(gone.status).toBe(404);
  });

  it("accepts the 9router-go payload shape (scopeId + config JSON)", async () => {
    const result = await json(await policiesRoute.POST(post(
      "http://localhost/api/guardrails/policies",
      {
        name: "Go-shaped",
        scope: "model",
        scopeId: "gpt-x",
        config: JSON.stringify({ detectors: ["injection"], action: "warn" }),
      },
    )));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ scope: "model", target: "gpt-x", action: "warn" });
    expect(result.body.detectors).toEqual(["injection"]);
  });

  it("rejects an invalid policy with the store's own reasons", async () => {
    const result = await json(await policiesRoute.POST(post(
      "http://localhost/api/guardrails/policies",
      { name: "no target", scope: "model", detectors: ["pii"] },
    )));
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/target/);
  });

  it("rejects malformed JSON honestly", async () => {
    const response = await policiesRoute.POST(new Request("http://localhost/api/guardrails/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }));
    expect(response.status).toBe(400);
  });

  it("filters the list by scope and target", async () => {
    await policiesRoute.POST(post("http://localhost/api/guardrails/policies", {
      name: "scoped", scope: "provider", target: "openai", detectors: ["pii"], action: "log_only",
    }));
    const listed = await json(await policiesRoute.GET(
      new Request("http://localhost/api/guardrails/policies?scope=provider&target=openai"),
    ));
    expect(listed.body.length).toBeGreaterThan(0);
    expect(listed.body.every((p) => p.scope === "provider" && p.target === "openai")).toBe(true);

    const bad = await policiesRoute.GET(new Request("http://localhost/api/guardrails/policies?scope=galaxy"));
    expect(bad.status).toBe(400);
  });
});

describe("audit log route", () => {
  it("lists rows and enforces the limit contract", async () => {
    const store = await import("@/lib/guardrails/policyStore.js");
    await store.logDecision({
      direction: "outbound",
      decision: {
        action: "mask",
        findings: [{ detector: "email", entity: "email", severity: "medium", start: 0, end: 5 }],
      },
      provider: "openai",
      model: "gpt-x",
    });

    const listed = await json(await logsRoute.GET(new Request("http://localhost/api/guardrails/logs?limit=10")));
    expect(listed.status).toBe(200);
    expect(listed.body.length).toBeGreaterThan(0);
    expect(listed.body[0]).toMatchObject({ entity: "email", action: "mask", direction: "outbound" });

    const badLimit = await logsRoute.GET(new Request("http://localhost/api/guardrails/logs?limit=0"));
    expect(badLimit.status).toBe(400);

    const cleared = await json(await logsRoute.DELETE(
      new Request("http://localhost/api/guardrails/logs", { method: "DELETE" }),
    ));
    expect(cleared.status).toBe(200);
    expect(cleared.body.removed).toBeGreaterThan(0);
  });
});
