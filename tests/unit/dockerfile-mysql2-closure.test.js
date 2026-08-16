// Storage Covenant Wave C7 — the Dockerfile carries mysql2's FULL runtime closure.
//
// Why this test exists: pool.js loads mysql2 via a RUNTIME dynamic import
// (`await import("mysql2/promise")`) that Next's output file-tracing cannot
// follow, so the standalone build omits mysql2 entirely. The Dockerfile fixes
// that with explicit `COPY --from=builder /app/node_modules/<pkg>` lines — but
// mysql2 is NOT self-contained: it has runtime dependencies that ALSO load
// only through that untraced import. Copying mysql2 without them would crash
// at boot with MODULE_NOT_FOUND — exactly the failure the Docker smoke
// (scripts/docker-smoke-mysql.sh) is built to catch.
//
// Docker is dark on this host, so THIS test is the local guard: it recomputes
// mysql2's transitive runtime closure from the installed tree and asserts the
// Dockerfile carries every one of them. If mysql2 ever gains a dependency and
// the Dockerfile isn't extended, this fails LOUD here — before the image is cut.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const NM = path.join(ROOT, "node_modules");
const DOCKERFILE = path.join(ROOT, "Dockerfile");

/** Read a package.json from the installed tree (top-level hoist). */
function pkgJson(pkg) {
  const p = path.join(NM, pkg, "package.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Transitive runtime-dependency closure of a package. */
function closure(pkg) {
  const seen = new Set();
  const stack = [];
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const j = pkgJson(name);
    if (!j) {
      throw new Error(`dependency "${name}" not installed at ${NM} (chain: ${stack.join(" > ")})`);
    }
    stack.push(name);
    for (const dep of Object.keys(j.dependencies || {})) walk(dep);
    stack.pop();
  };
  walk(pkg);
  return seen;
}

describe("Wave C7 — the Dockerfile carries mysql2's runtime closure", () => {
  it("mysql2's transitive runtime closure is fully COPY'd into the image", () => {
    const needed = closure("mysql2"); // includes mysql2 itself
    const dockerfile = fs.readFileSync(DOCKERFILE, "utf8");

    // Every package in the closure must ride an explicit COPY line.
    const missing = [...needed].filter(
      (pkg) => !dockerfile.includes(`COPY --from=builder /app/node_modules/${pkg} ./node_modules/${pkg}`)
    );
    expect(missing, `mysql2 closure missing from Dockerfile COPY lines: ${missing.join(", ")}`).toEqual([]);
  });

  it("no stale COPY line names a package outside the mysql2 closure", () => {
    // Guard the other direction: a COPY line for a package that is NOT part of
    // the mysql2 closure means the list drifted (a dep was removed upstream but
    // the line stayed). Harmless at runtime, but a real invariant drift.
    const needed = closure("mysql2");
    const dockerfile = fs.readFileSync(DOCKERFILE, "utf8");
    const copied = [...dockerfile.matchAll(/COPY --from=builder \/app\/node_modules\/([\w.-]+) \.\/node_modules\/\1/g)]
      .map((m) => m[1]);
    // Only audit the mysql2-closure block: mysql2 + its deps. The sql.js /
    // node-forge / next COPYs are separate precedents with their own reasons.
    const knownOthers = new Set(["sql.js", "node-forge", "next"]);
    const stale = copied.filter((p) => !needed.has(p) && !knownOthers.has(p));
    expect(stale, `Dockerfile copies packages not in mysql2 closure: ${stale.join(", ")}`).toEqual([]);
  });
});
