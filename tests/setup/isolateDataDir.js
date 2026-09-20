// W5 · Token lifecycle — shared DATA_DIR isolation for tests (MIBP fix 11).
//
// Vela's tests must never write the operator's real DB — `~/.vela` on POSIX,
// `%APPDATA%/vela` on Windows (src/lib/dataDir.js). Several suites each
// hand-rolled the same incantation (tests/contract/driver-mode-matrix.test.js,
// tests/unit/apikey-*.test.js): mkdtemp → point DATA_DIR at it → drop the
// memoized adapter → resetModules so every DATA_DIR-derived constant
// re-evaluates → restore + rm on teardown. This is that pattern, generalized
// into one hook so a new test cannot forget a step and leak into the real DB.
//
// The env keys are the ones the boot matrix itself treats as DB-affecting;
// restoring them (not merely deleting DATA_DIR) keeps nested suites honest.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

const SAVED_KEYS = ["DATA_DIR", "VELA_DB_MODE", "VELA_DB_DRIVER", "VELA_MYSQL_URL"];

/**
 * Point DATA_DIR at a fresh temp directory for the current test.
 *
 * @param {string} [prefix]  mkdtemp prefix (identifies the suite in os.tmpdir)
 * @returns {{ dir: string, dispose: () => void }}
 */
export function isolateDataDir(prefix = "vela-test-") {
  const saved = {};
  for (const k of SAVED_KEYS) saved[k] = process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dir;
  // A stale mysql twin URL from the environment would outlive the isolation.
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  vi.resetModules();
  let disposed = false;
  return {
    dir,
    /** Restore the environment and remove the temp dir. Idempotent. */
    dispose() {
      if (disposed) return;
      disposed = true;
      // Close whatever adapter booted BEFORE the temp dir dies (Windows EPERM).
      try { global._dbAdapter?.instance?.close?.(); } catch {}
      try { global._mysqlAdapter?.instance?.close?.(); } catch {}
      delete global._dbAdapter;
      delete global._mysqlAdapter;
      for (const k of SAVED_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      fs.rmSync(dir, { recursive: true, force: true });
      vi.resetModules();
    },
  };
}
