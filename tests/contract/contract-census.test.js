// Storage Covenant Wave A4 — the AUTO-CENSUS PIN.
// Plan: plans/storage-covenant.md Testability fix (line 427):
//   "the harness imports the barrel, enumerates every exported symbol, FAILS
//    unless each appears in the parity-test registry OR the exempt registry —
//    the only mechanical guard against coverage erosion under the 1.8× tax."
//
// This is the ratchet: it enforces a BIJECTION between the public barrel's
// export surface and the harness registries. A new repo function that lands in
// the barrel without a registry entry fails this test. A registry entry that
// points at no real export also fails (no orphan / stale entries). As the
// EXEMPT_PENDING debt is paid wave-by-wave, entries migrate into the parity
// registry; this pin keeps the ledger honest the whole way.
import { describe, it, expect, vi } from "vitest";
import { PARITY_REGISTRY, EXEMPT_PROCESS, EXEMPT_PENDING, allClassified } from "./harness/registry.js";

describe("Storage Covenant A4 — contract auto-census pin", () => {
  it("every barrel export is classified exactly once (parity OR exempt-process OR exempt-pending)", async () => {
    vi.resetModules();
    const barrel = await import("@/lib/db/index.js");
    const exports = Object.keys(barrel).filter((k) => k !== "default");

    const unclassified = [];
    const doubleClassified = [];
    for (const name of exports) {
      const inParity = PARITY_REGISTRY.has(name);
      const inExemptProcess = Object.prototype.hasOwnProperty.call(EXEMPT_PROCESS, name);
      const inExemptPending = Object.prototype.hasOwnProperty.call(EXEMPT_PENDING, name);
      const hits = [inParity, inExemptProcess, inExemptPending].filter(Boolean).length;
      if (hits === 0) unclassified.push(name);
      if (hits > 1) doubleClassified.push(name);
    }

    expect(unclassified, `barrel exports with no registry home: ${unclassified.join(", ")}`).toEqual([]);
    expect(doubleClassified, `barrel exports in >1 registry: ${doubleClassified.join(", ")}`).toEqual([]);
  });

  it("every registry entry names a real barrel export (no orphans / stale debt)", async () => {
    vi.resetModules();
    const barrel = await import("@/lib/db/index.js");
    const exportSet = new Set(Object.keys(barrel).filter((k) => k !== "default"));

    const orphaned = [...allClassified()].filter((name) => !exportSet.has(name));
    expect(orphaned, `registry entries with no matching barrel export: ${orphaned.join(", ")}`).toEqual([]);
  });

  it("the census is total — barrel and registries cover the same set", async () => {
    vi.resetModules();
    const barrel = await import("@/lib/db/index.js");
    const exportSet = new Set(Object.keys(barrel).filter((k) => k !== "default"));
    const classifiedSet = allClassified();

    // Same cardinality + subset both ways = bijection.
    expect(classifiedSet.size).toBe(exportSet.size);
    expect([...exportSet].filter((n) => !classifiedSet.has(n))).toEqual([]);
    expect([...classifiedSet].filter((n) => !exportSet.has(n))).toEqual([]);
  });
});
