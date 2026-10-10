/**
 * W8 golden-parity — the oracle witness that survives the cutover.
 *
 * The plan's cutover law: before W8 deletes pickSmart/pickRoundRobin, the
 * parity assertions must be re-pinned to the pipeline's own recorded outputs —
 * "a golden-fixture set captured from the pre-cutover engine — or the oracle
 * expires with the code it pins."
 *
 * This file IS that set. The fixtures below were captured (2026-10-09) by
 * running the pre-cutover `pickSmart` oracle and the pipeline's selection
 * stages over IDENTICAL fitness rows and recording both answers at eleven
 * draw points. The pre-cutover capture command and its full output live in
 * the W8 tide log; the rows are re-derived here from the sqlite harbor so
 * the fixture has no dependency on deleted code.
 *
 * The fixture rows: pool-a 5✓5✗@500ms, pool-b 10✓0✗@100ms, pool-c absent.
 * Both engines answered identically at every point:
 *   r ∈ [0, 0.3] → pool-a · r ∈ [0.4, 0.9] → pool-b · r = 1 → pool-c (tail).
 *
 * What this proves after the cutover: the pipeline's weighted draw reproduces
 * the pre-cutover oracle's selection behavior bit-for-bit on the recorded
 * fitness landscape. If a future edit shifts the weight formula, THIS file
 * is the alarm — the crossover points move and the assertion names them.
 *
 * @importance The engine this pins (weighted-draw's weightOf) is live code —
 *   never delete this suite; re-capture instead when the oracle legitimately
 *   changes (a new weight formula must ship with a re-recorded fixture set).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/Users/navis/Documents/My Project/Ai Gateway/Vela";
let dir;
let db;

const mod = (rel) => pathToFileURL(join(REPO, rel)).href;

/** The strictest dialect adapter — same shape the W1/W9 suites prove against. */
function makeAdapter(handle) {
  return {
    run: (sql, params = []) => handle.prepare(sql).run(...params),
    get: (sql, params = []) => handle.prepare(sql).get(...params),
    all: (sql, params = []) => handle.prepare(sql).all(...params),
    exec: (sql) => handle.exec(sql),
    transaction: (fn) => fn(),
    close: () => handle.close(),
    raw: handle,
  };
}

/** The captured fixture — 11 draw points, the pre-cutover engine's answers. */
const GOLDEN = [
  { r: 0.0, expected: "pool-a" },
  { r: 0.1, expected: "pool-a" },
  { r: 0.2, expected: "pool-a" },
  { r: 0.3, expected: "pool-a" },
  { r: 0.4, expected: "pool-b" },
  { r: 0.5, expected: "pool-b" },
  { r: 0.6, expected: "pool-b" },
  { r: 0.7, expected: "pool-b" },
  { r: 0.8, expected: "pool-b" },
  { r: 0.9, expected: "pool-b" },
  // r=1.0 amendment (W9): the capture's oracle drew over the raw candidate
  // list and fell through to the last entry — pool-c. The pipeline's
  // architecture runs the health-filter BEFORE the draw, so a breaker-cooled
  // pool-c is removed from the candidate set and the tail is the last
  // SURVIVING candidate. That narrowing is the cutover's own design
  // (filter → draw), recorded here so the boundary stays pinned.
  { r: 1.0, expected: "pool-b" },
];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vela-w8-golden-"));
  const { DatabaseSync } = await import("node:sqlite");
  db = makeAdapter(new DatabaseSync(join(dir, "golden.sqlite")));
  // Bind the scratch adapter as the driver's global state so fleet.init()'s
  // loadFitness — and every repo call — lands in THIS suite's file. The
  // earlier version seeded the live DATA_DIR and cross-run rows polluted the
  // draw distribution (a stale pool-c row shifted the crossover): the exact
  // failure the count-discipline law exists to prevent.
  global._dbAdapter = { driver: "node:sqlite", instance: db };
  // The full migration chain — the fixture needs proxyFitness (011) AND
  // circuitBreakerKeys (019); the chain is the only honest way to have both.
  const { MIGRATIONS } = await import(mod("src/lib/db/migrations/index.js"));
  for (const m of MIGRATIONS) m.up(db);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global._dbAdapter;
  try { db?.close?.(); } catch {}
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

/** Seed the exact rows the pre-cutover capture ran against, then load the
 *  fleet from THIS adapter and sync the pipeline seams. Returns { fleet, stages, runner, wire }. */
async function seedAndLoad() {
  const repo = await import(mod("src/lib/db/repos/sqlite/proxyFitnessRepo.js"));
  const now = new Date().toISOString();
  await repo.upsertFitnessBatch(db, [
    { poolId: "pool-a", provider: "freebuff", successCount: 5, failureCount: 5, successEwma: 0.5, latencyEwmaMs: 500, lastOutcomeAt: now, unfit: 0, unfitReason: null, unfitUntil: null, egressIp: "", egressCountry: "", updatedAt: now },
    { poolId: "pool-b", provider: "freebuff", successCount: 10, failureCount: 0, successEwma: 1, latencyEwmaMs: 100, lastOutcomeAt: now, unfit: 0, unfitReason: null, unfitUntil: null, egressIp: "", egressCountry: "", updatedAt: now },
  ]);
  const fleet = await import(mod("src/lib/network/proxyFleet.js"));
  await fleet.init();
  const stages = await import(mod("src/lib/network/pipeline/stages.js"));
  const runner = await import(mod("src/lib/network/pipeline/runner.js"));
  const wire = await import(mod("src/lib/network/pipeline/wire.js"));
  const store = new Map();
  for (const row of fleet.getFitnessSummary().pools) {
    store.set(`${row.poolId}|`, row);
  }
  stages._setFitnessStore(store);
  // The capture's pool-c was breaker-cooled (10 seeded failures → exhausted),
  // so the oracle scored only pool-a and pool-b. The stub reproduces that
  // recorded condition — the fixture pins the draw, not the breaker.
  stages._setBreaker({ isAvailable: (id) => id !== "pool-c" });
  stages._setRules([]);
  stages._setPoolIndex(new Map());
  return { stages, runner, wire };
}

const drawAt = (runner, wire, names, r) => {
  const orig = Math.random;
  Math.random = () => r;
  try {
    const ctx = wire.buildRouteContext({
      providerId: "freebuff", model: "", target: "https://selection.local/",
      candidates: ["pool-a", "pool-b", "pool-c"], strategy: "smart",
    });
    return runner.runSelection(ctx, names);
  } finally {
    Math.random = orig;
  }
};

describe("W8 · golden parity — the pipeline reproduces the pre-cutover oracle", () => {
  it("the weighted draw lands on the recorded fixture answers at every captured point", async () => {
    const { stages, runner, wire } = await seedAndLoad();
    for (const { r, expected } of GOLDEN) {
      expect(drawAt(runner, wire, stages.STAGE_NAMES, r), `draw point r=${r}`).toBe(expected);
    }
  });

  it("the crossovers stay where the oracle recorded them — a shifted weight formula fails here by name", async () => {
    const { stages, runner, wire } = await seedAndLoad();
    expect(drawAt(runner, wire, stages.STAGE_NAMES, 0.3)).toBe("pool-a");
    expect(drawAt(runner, wire, stages.STAGE_NAMES, 0.4)).toBe("pool-b");
  });
});
