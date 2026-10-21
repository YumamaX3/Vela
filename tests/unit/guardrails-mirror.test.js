// Guardrails × Storage Covenant C5 — mirror capture proof.
//
// The guardrail store was refactored from raw SQL to the twin repo facade
// (src/lib/db/repos/{sqlite,mysql}/guardrailsRepo.js). This pins the part that
// refactor could silently break: under VELA_DB_MODE=mirror every policy/audit
// WRITER must leave an outbox row the pump can replay onto the MariaDB twin.
// The rows carry no matched value — excerpts are already masked upstream — and
// the policy args are the full merged row, which is why the registry classes
// them idempotent-upsert.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-guardrails-mirror-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.MODE = process.env.VELA_DB_MODE;
  saved.MYSQL_URL = process.env.VELA_MYSQL_URL;
  process.env.DATA_DIR = tempDir;
  process.env.VELA_DB_MODE = "mirror";
  delete process.env.VELA_MYSQL_URL;
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

async function outboxRows() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return (await getAdapter()).all(`SELECT * FROM outbox ORDER BY seq ASC`);
}

describe("guardrails × mirror — every writer reaches the outbox", () => {
  it("policy CRUD and audit writes are captured as idempotent upserts", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const store = await import("@/lib/guardrails/policyStore.js");

    const created = await store.createPolicy({
      name: "mirror proof",
      scope: "global",
      detectors: ["email", "secrets"],
      action: "block",
    });
    expect(created.ok).toBe(true);

    await store.updatePolicy(created.policy.id, { name: "mirror proof v2" });
    await store.deletePolicy(created.policy.id);

    const policyRows = (await outboxRows()).filter((r) =>
      ["upsertGuardrailPolicy", "deleteGuardrailPolicy"].includes(r.fnName));
    expect(policyRows.map((r) => r.fnName)).toEqual([
      "upsertGuardrailPolicy",       // create
      "upsertGuardrailPolicy",       // update (full merged row)
      "deleteGuardrailPolicy",
    ]);
    expect(policyRows.every((r) => r.replayClass === "idempotent-upsert")).toBe(true);
    expect(policyRows.every((r) => r.identity === null)).toBe(true);

    // The args are the full row — replay can REPLACE without re-reading state.
    const [updateArgs] = JSON.parse(policyRows[1].args);
    expect(updateArgs.name).toBe("mirror proof v2");
    expect(updateArgs.id).toBe(created.policy.id);
    expect(updateArgs.detectors).toEqual(["email", "secrets"]);

    // Audit: one row per entity, carrying only the already-masked excerpt.
    await store.logDecision({
      policy: created.policy,
      direction: "inbound",
      decision: { action: "block", findings: [
        { detector: "email", entity: "email", severity: "high" },
        { detector: "email", entity: "email", severity: "high" },
        { detector: "email", entity: "phone", severity: "medium" },
      ] },
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-1",
      excerpt: "j***@example.com",
    });
    await store.clearLogs({ beforeMs: Date.now() + 60_000 });

    const logRows = (await outboxRows()).filter((r) =>
      ["insertGuardrailLog", "deleteGuardrailLogs"].includes(r.fnName));
    expect(logRows.map((r) => r.fnName)).toEqual([
      "insertGuardrailLog",
      "insertGuardrailLog",
      "deleteGuardrailLogs",
    ]);
    expect(logRows.every((r) => r.replayClass === "idempotent-upsert")).toBe(true);

    const [firstLog] = JSON.parse(logRows[0].args);
    expect(firstLog).toMatchObject({
      entity: "email", matchCount: 2, excerpt: "j***@example.com",
      provider: "openai", model: "gpt-4o",
    });
    expect(JSON.stringify(firstLog)).not.toMatch(/@example\.com[^"]/); // no unmasked body
  });
});
