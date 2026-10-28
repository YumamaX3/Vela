// M4's boot binding — the one seam no suite exercised.
//
// The suites construct PersistentBreakerStore directly, so nothing has ever
// proven the path boot actually takes: openStoreAdapter() → createLedgerStorage →
// PersistentBreakerStore → bindBreakerPersistence → a window that persists on the
// state change and refuses admission after a restart. This suite fires that chain
// under the vitest alias map, against a real sqlite file in a temp DATA_DIR — the
// same isolation floor the breaker-ledger suite stands on.
//
// What it does NOT prove: that register() itself runs under Next. That is the
// Edge bundle's own boundary — the nodejs guard is Next's contract, and no unit
// suite can fire it. What it proves is that everything behind the guard works.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(async () => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-breaker-boot-"));
  process.env.DATA_DIR = tempDir;
});

// Windows: the sqlite handle is still open here, and rmSync on a held file
// answers EPERM. force:true ignores nothing on Windows — so best-effort,
// and the OS reaps its own temp dir.
afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 1 });
    } catch { /* best-effort on a held handle */ }
  }
});

const KEY = "codebuddy-cn:conn-boot";

describe("the boot binding fires end to end", () => {
  it("binds the gate to a real ledger store, persists a window, and restores it", async () => {
    const { openStoreAdapter } = await import("@/lib/db/repos/sqlite/storeAdapter.js");
    const db = await openStoreAdapter();

    const gate = await import("../../open-sse/shared/codebuddy/gate.js");
    const { bindCodeBuddyBreaker } = await import("../../open-sse/shared/codebuddy/breakerBinding.js");

    // A clean gate, and no leaked persistence from any earlier run: resetBreakers
    // clears the Map but NOT the bound store, so the null bind is the honest unbind.
    gate.__test__.resetBreakers();
    gate.bindBreakerPersistence(null);

    // Bind the way boot binds — BEFORE arming, so every later state change
    // writes through to the bound store.
    bindCodeBuddyBreaker(db);

    // Arm the breaker through the request path's own recording calls. The
    // window opens at the threshold, and the write lands in the ledger.
    for (let i = 0; i < gate.__test__.BREAKER_THRESHOLD; i++) {
      gate.breakerRecordFailure(KEY);
    }
    // The FIRST admit consumes the half-open probe (true by design — one
    // request is allowed through to test the shore); the SECOND is the
    // honest answer while the window runs.
    gate.breakerTryAdmit(KEY);
    expect(gate.breakerTryAdmit(KEY)).toBe(false);

    // The window landed in the ledger itself, carrying its own product.
    const { getBreakerRows } = await import("@/lib/db/repos/circuitBreakerRepo.js");
    const rows = getBreakerRows(db, null).filter(
      (row) => row.poolId === "codebuddy" && row.model === KEY,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].provider).toBe("codebuddy-cn");
    expect(Number(rows[0].cooldownUntil)).toBeGreaterThan(Date.now());

    // Restore across a "restart": memory wiped, a fresh store bound to the
    // same ledger, and the persisted window alone refuses admission.
    // The probe is consumed first, exactly as one live request would.
    const { PersistentBreakerStore } = await import("../../open-sse/shared/codebuddy/breakerStore.js");
    const { createLedgerStorage } = await import("../../open-sse/shared/codebuddy/breakerLedger.js");
    gate.__test__.resetBreakers();
    gate.bindBreakerPersistence(new PersistentBreakerStore({ storage: createLedgerStorage(db) }));
    gate.breakerTryAdmit(KEY);
    expect(gate.breakerTryAdmit(KEY)).toBe(false);
  });
});