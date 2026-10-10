/**
 * W11 · the routing ledger — the trace as a first-class output.
 *
 * The plan's F10 sealing criterion: the ledger is walk-proven — a recorded
 * route can be read back, scoped, and rolled into the operator's health
 * score. The ring is FIXED at 256 slots (the plan's own budget), overwritten
 * in place: the suite proves the oldest row falls off, the sample keeps
 * failures richer than successes, and `null` is the honest score for a
 * provider with no traffic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/Users/navis/Documents/My Project/Ai Gateway/Vela";
const mod = (rel) => pathToFileURL(join(REPO, rel)).href;
let dir;
let ledger;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vela-w11-"));
  ledger = await import(mod("src/lib/network/pipeline/ledger.js"));
  ledger.clearLedger();
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

describe("W11 · the ring", () => {
  it("records and reads back, newest first", () => {
    ledger.recordRoute({ providerId: "prov", poolId: "p1", ok: true, ms: 42 });
    ledger.recordRoute({ providerId: "prov", poolId: "p2", ok: false, haltReason: "refused", ms: 10 });
    const rows = ledger.recentRoutes({ providerId: "prov" });
    expect(rows).toHaveLength(2);
    expect(rows[0].poolId).toBe("p2"); // newest first
    expect(rows[1].poolId).toBe("p1");
    // A failure keeps its walk; a success keeps only span names.
    expect(rows[0].haltReason).toBe("refused");
  });

  it("the 256-slot ring overwrites in place — the oldest row falls off", () => {
    for (let i = 0; i < 300; i++) {
      ledger.recordRoute({ providerId: "prov", poolId: `p${i}`, ok: true });
    }
    const rows = ledger.recentRoutes({ limit: 256 });
    expect(rows).toHaveLength(256);
    // Newest is p299; the oldest SURVIVING row is p44 (300 - 256).
    expect(rows[0].poolId).toBe("p299");
    expect(rows[255].poolId).toBe("p44");
    expect(ledger.recentRoutes({ limit: 256 }).some((r) => r.poolId === "p0")).toBe(false);
  });

  it("sampling: successes keep span names only, failures keep the walk", () => {
    const spans = [
      { stage: "rule-resolve", decision: "ok", ms: 0.1, detail: "no match" },
      { stage: "weighted-draw", decision: "ok", ms: 0.3, detail: "drew pool-b" },
    ];
    ledger.recordRoute({ providerId: "prov", poolId: "p1", ok: true, spans });
    ledger.recordRoute({ providerId: "prov", poolId: "p2", ok: false, haltReason: "refused", spans });
    const [failRow, okRow] = ledger.recentRoutes({ providerId: "prov" });
    expect(okRow.spans[0]).toBe("rule-resolve"); // name only
    expect(failRow.spans[0]).toEqual({ stage: "rule-resolve", decision: "ok", detail: "no match", ms: 0.1 });
  });
});

describe("W11 · the health score", () => {
  it("rolls the ring into a per-provider success rate; null for no traffic", () => {
    expect(ledger.healthScore("ghost")).toBeNull();
    for (let i = 0; i < 7; i++) ledger.recordRoute({ providerId: "prov", poolId: "p1", ok: true });
    for (let i = 0; i < 3; i++) ledger.recordRoute({ providerId: "prov", poolId: "p1", ok: false, haltReason: "refused" });
    const score = ledger.healthScore("prov");
    expect(score.score).toBe(70);
    expect(score.samples).toBe(10);
    const all = ledger.healthScore();
    expect(all.prov.score).toBe(70);
  });
});
