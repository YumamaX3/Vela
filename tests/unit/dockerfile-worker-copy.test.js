// M10 — "The Hull Fitting": the runner image carries the log shipper's worker
// AND pins the worker's driver.
//
// WHY THIS TEST EXISTS (the seam it guards):
// `initLogshipper` spawns a REAL `worker_threads` Worker BY PATH —
// `new Worker(new URL("./worker.js", import.meta.url))` (logshipper/index.js:424).
// Next's standalone output tracing follows STATIC import edges only; `new
// Worker(url)` is a runtime path load with no edge to walk, so worker.js is
// silently absent from `.next/standalone` and the image ships without it. The
// shipper would then die at boot — taking the durable log ledger with it — and
// the failure is a runtime ENOENT inside a spawned THREAD, far from any import
// site a reader would check. The fix is an explicit COPY, exactly like the
// mysql2 closure (dockerfile-mysql2-closure.test.js) and the MITM copy.
//
// THE NON-OBVIOUS HALF — WHY THIS FILE COPIES A CLOSURE, NOT ONE FILE:
// The worker is loaded by PATH, so Node's own ESM loader resolves its relative
// imports. NO bundler follows them, and `@/` does not resolve in a spawned
// thread at all (workerDriver.js's header records that measurement). So a lone
// `COPY .../worker.js` would ENOENT on `./writer.js` at first boot — a COPY that
// LOOKS correct and is dead on arrival. These assertions are written against the
// MEASURED closure, not against the single file the plan names.
//
// THE SECOND ASSERTION SET — the ENV is load-bearing, not documentation:
// The runner does NOT pin `VELA_DB_DRIVER` (only the BUILDER does, and that ENV
// is builder-scoped by design). So the worker's driver is whatever the chain
// resolves unless something pins it. `VELA_LOG_DRIVER` is that pin, which makes
// "node:sqlite in prod" TRUE instead of inferred.
//
// Docker is dark on this host, so this file is the local guard: plain-text
// assertions on the Dockerfile, no build. Each case names the exact line it
// asserts so a mutation lands on precisely one of them.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const DOCKERFILE = path.join(ROOT, "Dockerfile");
const LOGSHIPPER_DIR = path.join(ROOT, "src", "lib", "logshipper");

const dockerfile = () => fs.readFileSync(DOCKERFILE, "utf8");

/**
 * The runner stage's text only. The builder stage is a different FROM and the
 * two must never be conflated — the builder already pins VELA_DB_DRIVER (line
 * 24), so a naive whole-file search for a driver ENV would pass on the wrong
 * stage's line and prove nothing.
 */
function runnerStage() {
  const text = dockerfile();
  const start = text.indexOf("FROM ${NODE_IMAGE} AS runner");
  expect(start, "runner stage not found in Dockerfile").toBeGreaterThan(-1);
  return text.slice(start);
}

/**
 * True when `relative` is COPY'd (source AND destination) into the runner.
 * Accepts either an explicit per-file line or a whole-directory line that
 * contains the file, so the guard describes the requirement ("this file must
 * be in the image") rather than one spelling of how it got there.
 */
function copiesIntoRunner(relative) {
  const stage = runnerStage();
  return stage
    .split("\n")
    .filter((line) => line.startsWith("COPY --from=builder "))
    .some((line) => {
      const m = line.match(/^COPY --from=builder \/app\/(\S+)(?:\s+(\.\/\S+))?\s*$/);
      if (!m) return false;
      const [, source, dest = `./${m[1]}`] = m;
      const target = dest.replace(/^\.\//, "").replace(/\/$/, "");
      return relative === target || relative.startsWith(`${target}/`);
    });
}

describe("M10 — the runner image carries the log shipper's worker", () => {
  it("copies worker.js — the file the Worker constructor is handed", () => {
    // The exact artifact the plan names, and the one whose absence kills boot.
    expect(
      copiesIntoRunner("src/lib/logshipper/worker.js"),
      "Dockerfile runner does not COPY src/lib/logshipper/worker.js — standalone tracing cannot follow new Worker(url), so the shipper would die at boot with ENOENT inside the spawned thread"
    ).toBe(true);
  });

  it("copies the worker's alias-free ESM closure — a lone worker.js is dead on arrival", () => {
    // Measured closure of worker.js's relative imports (Node resolves these, no
    // bundler does). Each entry is required at BOOT: worker.js statically
    // imports writer.js, workerDriver.js and logStore.js at module scope, and
    // logStore.js + the adapters statically import schema.js / checkpointOwner.js.
    // A missing one throws ERR_MODULE_NOT_FOUND before the first batch is drained.
    const closure = [
      "src/lib/logshipper/writer.js", // worker.js:25 — the SAB ring codec
      "src/lib/logshipper/workerDriver.js", // worker.js:26 — opens the worker's own handle
      "src/lib/db/repos/sqlite/logStore.js", // worker.js:27 — createLogStore
      "src/lib/db/adapters/nodeSqliteAdapter.js", // the pinned driver (VELA_LOG_DRIVER)
      "src/lib/db/adapters/betterSqliteAdapter.js", // the chain's first attempt
      "src/lib/db/adapters/bunSqliteAdapter.js", // the chain's Bun attempt
      "src/lib/db/adapters/sqljsAdapter.js", // the chain's last-resort attempt
      "src/lib/db/schema.js", // adapters + logStore import PRAGMA_SQL / TABLES
      "src/lib/db/checkpointOwner.js", // adapters import registerNativeHandle
    ];
    const missing = closure.filter((f) => !copiesIntoRunner(f));
    expect(
      missing,
      `worker.js's runtime closure missing from the runner image: ${missing.join(", ")} — the worker is loaded BY PATH, so Node resolves these relative imports and no bundler follows them`
    ).toEqual([]);
  });

  it("copies the closure sources that actually exist on disk", () => {
    // A COPY line can name a path the builder no longer has; docker would fail
    // the build rather than skip it, so pin the sources against the real tree.
    for (const f of ["worker.js", "writer.js", "workerDriver.js"]) {
      expect(
        fs.existsSync(path.join(LOGSHIPPER_DIR, f)),
        `${f} is named by the Dockerfile closure but is absent from src/lib/logshipper/`
      ).toBe(true);
    }
  });

  it("pins VELA_LOG_DRIVER=node:sqlite in the RUNNER stage, not just the builder", () => {
    // The pin must sit in the runner: the builder's VELA_DB_DRIVER (line 24) is
    // builder-scoped by design and never reaches the shipped image, so a match
    // found anywhere in the file would pass on the wrong line and prove nothing.
    expect(
      /^ENV VELA_LOG_DRIVER=node:sqlite$/m.test(runnerStage()),
      "runner stage lacks ENV VELA_LOG_DRIVER=node:sqlite — the worker's driver is then whatever the fallback chain resolves, not the declared one"
    ).toBe(true);
  });

  it("keeps the pin on a builtin driver — no native addon in the worker thread", () => {
    // node:sqlite lives inside the node binary. better-sqlite3 would be a
    // native .node load, which is the arm64-under-QEMU SIGILL class (Dockerfile
    // :16-23) and would reintroduce it inside the worker thread.
    const pin = runnerStage().match(/^ENV VELA_LOG_DRIVER=(\S+)$/m);
    expect(pin, "no VELA_LOG_DRIVER ENV found in the runner stage").not.toBeNull();
    expect(pin[1], "VELA_LOG_DRIVER must name a builtin driver (node:sqlite), not a native addon").toBe("node:sqlite");
  });

  it("declares the pin exactly once, in the runner, leaving the builder's own law alone", () => {
    // The builder's forced VELA_DB_DRIVER (Dockerfile:24) is load-bearing for the
    // arm64-under-QEMU build and must stay exactly as it is — it is deliberately
    // builder-scoped. So the invariant is not "no pin before the first COPY" (the
    // runner's own ENV block legitimately precedes the COPYs); it is that the
    // worker's pin is declared ONCE and lives in the runner. A duplicate ENV
    // would be drift, and a pin that strayed into the builder would never reach
    // the shipped image — making the declaration a lie.
    const all = (dockerfile().match(/^ENV VELA_LOG_DRIVER=/gm) || []).length;
    expect(all, "VELA_LOG_DRIVER must be declared exactly once in the whole Dockerfile").toBe(1);

    // And the builder's own pin must survive untouched.
    const text = dockerfile();
    const builderStart = text.indexOf("FROM base AS builder");
    const builderEnd = text.indexOf("FROM ${NODE_IMAGE} AS runner");
    expect(text.slice(builderStart, builderEnd), "the builder's ENV VELA_DB_DRIVER=node:sqlite was disturbed").toContain(
      "ENV VELA_DB_DRIVER=node:sqlite"
    );
  });

  it("leaves the mysql2 closure intact — this tide's COPYs must not displace it", () => {
    // The fence. M10 adds source-file COPYs beside the package closure; if a
    // future edit reorders or truncates the block, mysql2's runtime deps vanish
    // and the mysql/mirror postures boot with no mysql2 present.
    const needed = [
      "mysql2", "aws-ssl-profiles", "generate-function", "iconv-lite", "is-property",
      "long", "lru.min", "named-placeholders", "safer-buffer", "sql-escaper",
    ];
    const missing = needed.filter(
      (pkg) => !runnerStage().includes(`COPY --from=builder /app/node_modules/${pkg} ./node_modules/${pkg}`)
    );
    expect(missing, `mysql2 closure lines displaced by M10: ${missing.join(", ")}`).toEqual([]);
  });
});