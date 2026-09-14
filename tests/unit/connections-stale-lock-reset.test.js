/**
 * M0-4 (ADR-004 The Great Fold, v0.9.62 The Proven Wounds) — a re-activated
 * connection must not inherit stale health state.
 *
 * Upstream 7fee56ba clears modelLock_*, errorCode, rateLimitedUntil and
 * backoffLevel when a connection is explicitly marked active (validation
 * passed / OAuth re-login). Vela's twin split (sqlite + mysql behind the
 * bindFacade) means the helper lands in BOTH repos; a new *exported* writer
 * would also need a mirror REPLAY_CLASSES entry — so it is deliberately a
 * private per-twin helper called inside updateProviderConnection's own
 * transaction. Each store normalizes its own row on replay: both harbors
 * converge by construction, and the registry entry for
 * updateProviderConnection (RMW_STALE_HAZARD) is unchanged.
 *
 * Proof shape:
 * · behavioral — the real sqlite adapter (proven harness from
 *   apikey-categories.test.js: temp DATA_DIR + delete global._dbAdapter +
 *   vi.resetModules in BOTH hooks) plants locks then re-activates;
 * · parity — the mysql twin's source must carry an equivalent call site,
 *   read as text, so the twins can never silently diverge again (this harbor
 *   already bled once from a bulk-health loop that forked — v0.9.44 LIVE-B).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-stalelock-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function loadRepo() {
  const repo = await import("@/lib/db/repos/sqlite/connectionsRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { repo, db: await getAdapter() };
}

describe("resetHealthStateOnActivation — sqlite twin, real adapter", () => {
  it("planting a dirty connection: re-activation clears locks, backoff, error fields", async () => {
    const { repo } = await loadRepo();
    const created = await repo.createProviderConnection({
      provider: "glm", authType: "apikey", name: "glm-main", apiKey: "sk-x",
    });
    // Dirty it the way a failure would: scoped + per-model + account locks,
    // backoff, cooldown, error markers, testStatus unavailable.
    const future = new Date(Date.now() + 600_000).toISOString();
    await repo.updateProviderConnection(created.id, {
      testStatus: "unavailable",
      lastError: "429",
      errorCode: 429,
      lastErrorAt: new Date().toISOString(),
      backoffLevel: 4,
      rateLimitedUntil: future,
    });
    await repo.updateProviderConnection(created.id, {
      modelLock___all: future,
      "modelLock_glm/glm-4-plus": future,
      "modelLock_websearch:glm": future, // the exact key shape S8 (M0-2) writes
    });
    let dirty = await repo.getProviderConnectionById(created.id);
    expect(dirty.modelLock___all).toBe(future);
    expect(dirty.backoffLevel).toBe(4);

    // The activation edge: dashboard validation / OAuth re-login path.
    await repo.updateProviderConnection(created.id, { testStatus: "active" });
    const clean = await repo.getProviderConnectionById(created.id);
    expect(clean.testStatus).toBe("active");
    expect(clean.modelLock___all).toBeNull();
    expect(clean["modelLock_glm/glm-4-plus"]).toBeNull();
    expect(clean["modelLock_websearch:glm"]).toBeNull();
    expect(clean.backoffLevel).toBe(0);
    expect(clean.rateLimitedUntil).toBeNull();
    expect(clean.errorCode).toBeNull();
    expect(clean.lastError).toBeNull();
    // Credentials survive — this is a health reset, not a wipe.
    expect(clean.apiKey).toBe("sk-x");
  });

  it("a NON-active patch passes through untouched (no side effects, byte-identical merge)", async () => {
    const { repo } = await loadRepo();
    const created = await repo.createProviderConnection({
      provider: "glm", authType: "apikey", name: "keep-me", apiKey: "sk-x",
    });
    const future = new Date(Date.now() + 600_000).toISOString();
    await repo.updateProviderConnection(created.id, {
      testStatus: "unavailable", "modelLock_glm/glm-4-plus": future, backoffLevel: 3,
    });
    await repo.updateProviderConnection(created.id, { lastTested: "2026-09-14T00:00:00.000Z" });
    const after = await repo.getProviderConnectionById(created.id);
    expect(after["modelLock_glm/glm-4-plus"]).toBe(future); // untouched by an unrelated patch
    expect(after.backoffLevel).toBe(3);
    expect(after.testStatus).toBe("unavailable");
    expect(after.lastTested).toBe("2026-09-14T00:00:00.000Z");
  });

  it("explicit caller-provided lastError on activation is HONORED, not defaulted away", async () => {
    // The Object.hasOwn branch: a caller saying "active + this lastError"
    // keeps its value; a caller that says nothing gets null.
    const { repo } = await loadRepo();
    const created = await repo.createProviderConnection({
      provider: "glm", authType: "apikey", name: "honored", apiKey: "sk-x",
    });
    await repo.updateProviderConnection(created.id, {
      testStatus: "active", lastError: "re-validated at login",
    });
    const after = await repo.getProviderConnectionById(created.id);
    expect(after.lastError).toBe("re-validated at login");
    expect(after.lastErrorAt).toBeNull();
  });
});

describe("twin parity — the mysql harbor carries the same law", () => {
  // Anchor at this file, not process.cwd(): vitest may run from repo root or
  // tests/ depending on how it's invoked. import.meta.url is the honest path.
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/lib/db/repos");
  const sqliteSrc = fs.readFileSync(path.join(repoRoot, "sqlite/connectionsRepo.js"), "utf8");
  const mysqlSrc = fs.readFileSync(path.join(repoRoot, "mysql/connectionsRepo.js"), "utf8");

  it("both twins define the helper and route updateProviderConnection through it", () => {
    for (const [name, src] of [["sqlite", sqliteSrc], ["mysql", mysqlSrc]]) {
      expect(src, `${name}: helper missing`).toContain("function resetHealthStateOnActivation(existing, patch)");
      expect(src, `${name}: call site missing`).toContain(
        "const merged = { ...existing, ...resetHealthStateOnActivation(existing, data), updatedAt:",
      );
    }
  });

  it("the helper bodies are line-identical between twins (no fork of the law)", () => {
    const grab = (src) => {
      const start = src.indexOf("function resetHealthStateOnActivation");
      const end = src.indexOf("\n}\n", start);
      return src.slice(start, end + 2);
    };
    expect(grab(mysqlSrc)).toBe(grab(sqliteSrc));
  });
});
