// TEST-ENVIRONMENT ISOLATION (the contamination root).
//
// WHY THIS FILE EXISTS — and why it is global rather than per-suite:
//
//   src/lib/dataDir.js does `export const DATA_DIR = getDataDir()` at MODULE
//   LOAD. Anything that reaches that module before a suite's `beforeEach` runs
//   captures the REAL `%APPDATA%\vela`. A suite-level `process.env.DATA_DIR =
//   tmpdir` is therefore only honoured for modules loaded AFTER it — the exact
//   trap src/lib/db/AGENTS.md:177 warns about ("the fallbacks are silent… Never
//   assume a test's DATA_DIR was honored by every subsystem").
//
//   The measured damage on this machine: `logEvents` ids 2 and 4000-19000 were
//   byte-matches of tests/unit/logshipper-degraded.test.js:81 and :185 (which
//   ships 7,000 rows of 'd'.repeat(8000)), and providerConnections rows named
//   `guard-<Date.now()>@example.com` (tests/unit/zed-live-models.test.js:156)
//   were created in the LIVE production store.
//
// WHY setupFiles AND NOT globalSetup:
//   `globalSetup` runs once in the MAIN process before the pool forks.
//   `setupFiles` runs inside EACH WORKER, before that worker's test modules are
//   imported — which is what `dataDir.js`'s module-load capture requires. A
//   globalSetup assignment would not reach the workers at all.
//
// A suite that sets its own DATA_DIR in beforeEach still overrides this and
// keeps working; this is a FLOOR, not a ceiling. It guarantees no suite can
// silently default to the operator's real database.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vela-test-"));
process.env.DATA_DIR = tmp;

// Make the sandbox obvious in failure output, so a stray write is legible in
// the test name rather than a mystery six hours later.
process.env.VELA_TEST_SANDBOX = "1";