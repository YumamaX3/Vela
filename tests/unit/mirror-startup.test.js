// Storage Covenant Wave C5 — the mirror posture bind + startup matrix.
//
// Plan (plans/storage-covenant.md): mirror = "sqlite PRIMARY serves; writes
// mirror to the twin through the outbox pump (C3); usage rides a watermark
// resync (C4); a divergence sweep guards the twin (C4). A down twin degrades
// the mirror — it NEVER silently downgrades the MODE."
//
// Pinned here against a REAL sqlite primary (the twin is absent — mirror must
// start degraded and keep serving; that is the whole point):
//   1. BIND — under VELA_DB_MODE=mirror the facades bind the sqlite harbor
//      behind the mirror decorator: a classified writer leaves an outbox row,
//      reads serve verbatim, getDbMode() STAYS "mirror".
//   2. HARBOR — assertHarborBound no longer refuses under mirror (the primary
//      is serving); dispatchData routes the backup contract to the sqlite harbor.
//   3. STARTUP — configureMirrorStartup arms pump + usage-resync + sweep under
//      mirror, and stops them under sqlite; it is fail-open + never throws.
//
// The live-twin legs of the mirror rhythm ride mirror-pump-live.test.js (C3)
// and mirror-sweep-live.test.js (C4) behind the double opt-in.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-c5-"));
  saved.DATA_DIR = process.env.DATA_DIR;
  saved.MODE = process.env.VELA_DB_MODE;
  saved.MYSQL = process.env.VELA_MYSQL_URL;
  saved.SECRET = process.env.API_KEY_SECRET;
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "c5-api-secret";
  delete process.env.VELA_MYSQL_URL; // mirror boots WITHOUT a reachable twin
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  // The rhythm conductors are global singletons — reset them so each leg
  // boots its own (a leftover armed pump from one leg must not leak into the
  // next leg's assertions).
  delete global.__velaMirror;
  delete global.__velaMirrorSweep;
  delete global.__velaUsageResync;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function boot(mode) {
  process.env.VELA_DB_MODE = mode;
  delete global._dbAdapter;
  delete global._mysqlAdapter;
  vi.resetModules();
}

describe("Wave C5 — the mirror bind (primary serves, decorator captures)", () => {
  it("a classified writer leaves an outbox row; reads serve; mode stays mirror", async () => {
    boot("mirror");
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const { getDbMode } = await import("@/lib/db/repos/bind.js");
    expect(getDbMode()).toBe("mirror"); // never silently downgrades

    const { createCombo, getCombos } = await import("@/lib/db/repos/combosRepo.js");
    const combo = await createCombo({ name: "c5-combo", kind: "fallback", models: ["m1"] });
    expect(combo.id).toBeTruthy();

    // Reads serve verbatim through the decorated facade.
    const list = await getCombos();
    expect(list.some((c) => c.name === "c5-combo")).toBe(true);

    // The writer left exactly one outbox row (identity-carrying, captured id).
    const { getAdapter } = await import("@/lib/db/driver.js");
    const rows = (await getAdapter()).all(`SELECT fnName, replayClass, status, identity FROM outbox`);
    expect(rows.length).toBe(1);
    expect(rows[0].fnName).toBe("createCombo");
    expect(rows[0].replayClass).toBe("identity-carrying");
    expect(rows[0].status).toBe("pending");
    const identity = JSON.parse(rows[0].identity);
    expect(identity.id).toBe(combo.id); // the GENERATED id is captured
  });

  it("assertHarborBound no longer refuses under mirror; dispatchData serves sqlite", async () => {
    boot("mirror");
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const { assertHarborBound } = await import("@/lib/db/repos/bind.js");
    await expect(assertHarborBound()).resolves.toBeUndefined(); // bound, not refusing

    // The backup contract rides the sqlite PRIMARY under mirror.
    const backup = await import("@/lib/db/repos/backupRepo.js");
    const payload = await backup.exportDb({ includeRequestDetails: false });
    expect(payload._meta.sourceMode).toBe("mirror");
    expect(payload.settings).toBeTruthy();
  });

  it("an exempt writer (saveRequestUsage) leaves NO outbox row under mirror", async () => {
    boot("mirror");
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    await saveRequestUsage({ provider: "p", model: "m", timestamp: "2026-08-16T06:00:00.000Z", tokens: { prompt_tokens: 5 } });

    const { getAdapter } = await import("@/lib/db/driver.js");
    const rows = (await getAdapter()).all(`SELECT * FROM outbox WHERE fnName = 'saveRequestUsage'`);
    expect(rows.length).toBe(0); // exempt — usage rides the watermark resync, never arg-replay
  });
});

describe("Wave C5 — the startup matrix (posture-scoped rhythms, fail-open)", () => {
  it("mirror arms pump + usage-resync + sweep; a down twin never blocks", async () => {
    boot("mirror");
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const { configureMirrorStartup } = await import("@/shared/services/mirrorStartup.js");
    // No reachable twin (VELA_MYSQL_URL unset) — startup must NOT throw, and
    // must arm the rhythms anyway (the primary keeps serving; mode stays mirror).
    expect(() => configureMirrorStartup()).not.toThrow();

    // Condition-based wait for the arm, never a fixed sleep: arming completes
    // when startMirrorRhythms' three dynamic imports resolve, and a cold
    // module graph (fresh vite transform cache — e.g. when this test runs
    // first or alone) can take far longer than any fixed window to load
    // them. The law under test is "arms even though the twin is down", not
    // "arms within N ms" — so poll the armed state with a generous budget.
    const { getMirrorPumpStatus } = await import("@/lib/db/mirror/mirrorPump.js");
    const armDeadline = Date.now() + 3000;
    while (!getMirrorPumpStatus().running && Date.now() < armDeadline) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const pump = getMirrorPumpStatus();
    expect(pump.running).toBe(true); // armed even though the twin is down
    const { getDbMode } = await import("@/lib/db/repos/bind.js");
    expect(getDbMode()).toBe("mirror"); // NEVER silently downgrades

    // Clean down the rhythms so the process can exit.
    const { stopMirrorRhythms } = await import("@/shared/services/mirrorStartup.js");
    await stopMirrorRhythms();
    expect(getMirrorPumpStatus().running).toBe(false);
  });

  it("sqlite posture stops the mirror rhythms (they ride the outbox, which only exists in mirror)", async () => {
    boot("sqlite");
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const { configureMirrorStartup } = await import("@/shared/services/mirrorStartup.js");
    expect(() => configureMirrorStartup()).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));

    const { getMirrorPumpStatus } = await import("@/lib/db/mirror/mirrorPump.js");
    expect(getMirrorPumpStatus().running).toBe(false); // not mirror → rhythms stopped
  });
});
