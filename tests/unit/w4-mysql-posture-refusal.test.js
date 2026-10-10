/**
 * W4 — MySQL posture refusal at the raw-adapter doorway.
 *
 * Proves the wound is closed: under a mysql posture the sqlite raw adapter is
 * refused LOUDLY instead of silently resolving a SQLite driver against
 * DATA_FILE and running the SQLite migration chain (the orphan-store wound).
 *
 * RED on pre-W4 HEAD: resolveDriver never read getDbMode(), so the posture was
 * adapter-mismatched AND repo-refused at once.
 */
import { describe, it, expect, afterEach } from "vitest";

const originalMode = process.env.VELA_DB_MODE;

afterEach(() => {
  if (originalMode === undefined) delete process.env.VELA_DB_MODE;
  else process.env.VELA_DB_MODE = originalMode;
});

// Imported fresh per case so getDbMode() re-reads the env the module observes.
async function freshDoorway() {
  const mod = await import("../../src/lib/db/repos/sqlite/storeAdapter.js");
  return mod;
}

describe("W4 — posture guard at the raw-adapter doorway", () => {
  it("refuses loudly under VELA_DB_MODE=mysql", async () => {
    process.env.VELA_DB_MODE = "mysql";
    const { openStoreAdapter } = await freshDoorway();
    // The refusal must name the posture and the reason — not a bare TypeError.
    await expect(openStoreAdapter()).rejects.toThrow(/VELA_DB_MODE=mysql/);
    await expect(openStoreAdapter()).rejects.toThrow(/bindFacade/);
  });

  it("refuses loudly under VELA_DB_MODE=mysql", async () => {
    process.env.VELA_DB_MODE = "mysql";
    const { openStoreAdapterSync } = await freshDoorway();
    expect(() => openStoreAdapterSync()).toThrow(/VELA_DB_MODE=mysql/);
  });

  it("does NOT refuse under VELA_DB_MODE=mirror — mirror's primary harbor IS the sqlite adapter", async () => {
    process.env.VELA_DB_MODE = "mirror";
    const { openStoreAdapterSync } = await freshDoorway();
    try {
      openStoreAdapterSync();
    } catch (err) {
      // A driver-unavailable error is fine here; a posture REFUSAL is not —
      // mirror = sqlite primary + MariaDB twin, so the raw adapter is the
      // posture's primary, never a mismatch.
      expect(String(err?.message)).not.toMatch(/VELA_DB_MODE=mysql/);
    }
  });

  it("does NOT refuse under the sqlite posture", async () => {
    process.env.VELA_DB_MODE = "sqlite";
    const { openStoreAdapter } = await freshDoorway();
    // Under sqlite the guard passes. Whether a driver is actually available is
    // a separate question — if none is, the error must NOT be the posture
    // refusal. That distinction is the whole assertion.
    try {
      await openStoreAdapter();
    } catch (err) {
      expect(err.message).not.toMatch(/VELA_DB_MODE=sqlite/);
      expect(err.message).not.toMatch(/fail loud, never silent downgrade/);
    }
  });
});
