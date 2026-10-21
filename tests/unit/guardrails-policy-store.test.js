// GUARDRAIL POLICY STORE — the rules that decide which policy wins, and the
// audit trail that remembers what it decided.
//
// The engine is proven separately (guardrails-engine.test.js). What is proven
// here is the part that can silently go wrong without a test: precedence.
// A "log_only" global rule must NEVER soften a narrow "block" rule; a scoped
// rule whose target does not match must match nothing; a disabled policy must
// be invisible. These are the cases an operator will rely on in the dark.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let driverRef = null;

async function boot() {
  const driver = await import("@/lib/db/driver.js");
  driverRef = driver;
  await driver.getAdapter();
  const store = await import("@/lib/guardrails/policyStore.js");
  return { driver, store };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-guardrails-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try {
    driverRef?.resetAdapter?.();
  } catch { /* already closed */ }
  driverRef = null;
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("policy CRUD", () => {
  it("creates, reads, updates and deletes a policy", async () => {
    const { store } = await boot();

    const created = await store.createPolicy({
      name: "Block PII",
      scope: "global",
      detectors: ["pii"],
      action: "block",
    });
    expect(created.ok).toBe(true);
    const id = created.policy.id;
    expect(created.policy.enabled).toBe(true);
    expect(created.policy.detectors).toEqual(["pii"]);

    expect(await store.getPolicy(id)).toMatchObject({ id, name: "Block PII", action: "block" });
    expect((await store.listPolicies()).map((p) => p.id)).toContain(id);

    const updated = await store.updatePolicy(id, { action: "mask", priority: 5 });
    expect(updated.ok).toBe(true);
    expect(updated.policy).toMatchObject({ action: "mask", priority: 5 });

    const deleted = await store.deletePolicy(id);
    expect(deleted.ok).toBe(true);
    expect(await store.getPolicy(id)).toBeNull();
  });

  it("rejects a scoped policy with no target, and unknown vocabularies", async () => {
    const { store } = await boot();

    const noTarget = await store.createPolicy({ name: "model rule", scope: "model", detectors: ["pii"] });
    expect(noTarget.ok).toBe(false);
    expect(noTarget.errors.join(" ")).toMatch(/target/);

    const badScope = await store.createPolicy({ name: "x", scope: "galaxy" });
    expect(badScope.ok).toBe(false);

    const badAction = await store.createPolicy({ name: "x", action: "explode" });
    expect(badAction.ok).toBe(false);

    const badDirection = await store.createPolicy({ name: "x", direction: "sideways" });
    expect(badDirection.ok).toBe(false);

    const emptyName = await store.createPolicy({ name: "   " });
    expect(emptyName.ok).toBe(false);
  });

  it("treats an empty detector list as scanning nothing — never everything", async () => {
    const { store } = await boot();
    const created = await store.createPolicy({ name: "silent", detectors: [] });
    expect(created.ok).toBe(true);
    const policy = await store.getPolicy(created.policy.id);
    expect(policy.detectors).toEqual([]);
  });
});

describe("resolver precedence", () => {
  it("a specific scope beats a global one", async () => {
    const { store } = await boot();
    const global = await store.createPolicy({ name: "g", scope: "global", detectors: ["pii"], action: "block" });
    const model = await store.createPolicy({ name: "m", scope: "model", target: "gpt-x", detectors: ["pii"], action: "mask" });
    expect(global.ok && model.ok).toBe(true);

    const winner = await store.resolvePolicy({ model: "gpt-x" });
    expect(winner.id).toBe(model.policy.id);

    const fallback = await store.resolvePolicy({ model: "other" });
    expect(fallback.id).toBe(global.policy.id);
  });

  it("lower priority wins within one scope", async () => {
    const { store } = await boot();
    const loose = await store.createPolicy({ name: "loose", scope: "global", priority: 50, detectors: ["pii"], action: "log_only" });
    const tight = await store.createPolicy({ name: "tight", scope: "global", priority: 10, detectors: ["pii"], action: "warn" });
    expect(loose.ok && tight.ok).toBe(true);

    const winner = await store.resolvePolicy({});
    expect(winner.id).toBe(tight.policy.id);
  });

  it("the stricter action wins a full tie — a log-only rule cannot soften a block", async () => {
    const { store } = await boot();
    const a = await store.createPolicy({ name: "a", scope: "global", priority: 100, detectors: ["pii"], action: "log_only" });
    const b = await store.createPolicy({ name: "b", scope: "global", priority: 100, detectors: ["pii"], action: "block" });
    expect(a.ok && b.ok).toBe(true);

    const winner = await store.resolvePolicy({});
    expect(winner.id).toBe(b.policy.id);
    expect(winner.action).toBe("block");
  });

  it("a disabled policy is invisible", async () => {
    const { store } = await boot();
    const off = await store.createPolicy({ name: "off", scope: "global", detectors: ["pii"], action: "block", enabled: false });
    expect(off.ok).toBe(true);
    expect(await store.resolvePolicy({})).toBeNull();
  });

  it("a scoped policy whose target does not match matches nothing", async () => {
    const { store } = await boot();
    const p = await store.createPolicy({ name: "one model", scope: "model", target: "gpt-x", detectors: ["pii"], action: "block" });
    expect(p.ok).toBe(true);
    expect(await store.resolvePolicy({ model: "gpt-y" })).toBeNull();
    expect(await store.resolvePolicy({})).toBeNull();
  });

  it("honours the direction a policy names", async () => {
    const { store } = await boot();
    const inbound = await store.createPolicy({ name: "in", scope: "global", direction: "inbound", detectors: ["pii"], action: "block" });
    expect(inbound.ok).toBe(true);

    expect((await store.resolvePolicy({ direction: "inbound" })).id).toBe(inbound.policy.id);
    expect(await store.resolvePolicy({ direction: "outbound" })).toBeNull();
    // No direction asked = no filter (the store's public callers).
    expect((await store.resolvePolicy({})).id).toBe(inbound.policy.id);
  });
});

describe("audit log", () => {
  const decision = {
    action: "block",
    findings: [
      { detector: "email", entity: "email", severity: "medium", start: 0, end: 5 },
      { detector: "email", entity: "email", severity: "medium", start: 10, end: 15 },
      { detector: "credit_card", entity: "credit_card", severity: "high", start: 20, end: 36 },
    ],
  };

  it("writes one row per entity, never the matched value", async () => {
    const { store } = await boot();
    const policy = await store.createPolicy({ name: "audit", detectors: ["pii"], action: "block" });

    await store.logDecision({
      policy: policy.policy,
      direction: "inbound",
      decision,
      provider: "openai",
      model: "gpt-x",
      connectionId: "conn-1",
      excerpt: "mail [REDACTED] and [REDACTED]",
    });

    const rows = await store.listLogs({ limit: 10 });
    expect(rows).toHaveLength(2);
    const email = rows.find((r) => r.entity === "email");
    const card = rows.find((r) => r.entity === "credit_card");
    expect(email.matchCount).toBe(2);
    expect(card.matchCount).toBe(1);
    expect(card.severity).toBe("high");
    expect(card.action).toBe("block");
    expect(card.policyId).toBe(policy.policy.id);
    // The table stores an excerpt that the CALLER already masked; no finding
    // field carries a value at all.
    expect(JSON.stringify(rows)).not.toMatch(/4111|@acme/);
  });

  it("filters and clears by entity and time", async () => {
    const { store } = await boot();
    const policy = await store.createPolicy({ name: "audit", detectors: ["pii"], action: "warn" });

    await store.logDecision({ policy: policy.policy, direction: "inbound", decision, provider: "p" });
    const all = await store.listLogs({ limit: 10 });
    expect(all.length).toBe(2);

    const onlyCards = await store.listLogs({ entity: "credit_card" });
    expect(onlyCards).toHaveLength(1);

    const removed = await store.clearLogs({});
    expect(removed).toBe(2);
    expect(await store.listLogs({})).toHaveLength(0);
  });

  it("a decision with no findings writes nothing", async () => {
    const { store } = await boot();
    await store.logDecision({ direction: "inbound", decision: { action: "allow", findings: [] } });
    expect(await store.listLogs({})).toHaveLength(0);
  });
});
