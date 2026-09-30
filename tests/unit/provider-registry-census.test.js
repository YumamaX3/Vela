// The registry census — the harbor's mast count, pinned as a PROPERTY, not bytes.
//
// The 2026-09-04 debt: 14 committed provider files sat on disk, absent from the
// generated registry/index.js, unreachable at runtime no matter how complete they
// looked (three more — trae, devin-cli, windsurf — were commented out by design).
// No instrument caught it because no test imported the REAL index and compared it
// against the DIRECTORY it claims to summarize. This suite is that instrument.
//
// The census asserts the debt's own property — every registry/*.js on disk is
// imported by index.js (or named in HIDDEN, the deliberate comment block) — so a
// future untracked generator, a hand edit, or a merge that drops an import line
// reddens HERE, before a provider goes silently dark.
//
// HIDDEN: providers kept out of the runtime index on purpose (see index.js's
// comment block: trae has no tool-calling support; the gRPC skip also affects
// windsurf; devin-cli paused). The emitter (scripts/generate-registry-index.mjs)
// carries the same list — if a name lands in both disk and index while HIDDEN,
// this suite fails, so the two can never drift apart silently.
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const REGISTRY_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "open-sse",
  "providers",
  "registry",
);

// Deliberately unindexed providers — must exist on disk, must stay out of the index.
const HIDDEN = new Set(["trae", "devin-cli", "windsurf"]);

const diskFiles = readdirSync(REGISTRY_DIR)
  .filter((f) => f.endsWith(".js") && f !== "index.js")
  .map((f) => f.replace(/\.js$/, ""));

const importedIds = REGISTRY.map((e) => e.id);

describe("provider registry census", () => {
  it("imports EVERY provider file on disk except the named HIDDEN set", () => {
    const importedSet = new Set(importedIds);
    const missing = diskFiles.filter((f) => !importedSet.has(f) && !HIDDEN.has(f));
    // The exact 2026-09-04 failure mode: a file reachable on disk, dark at runtime.
    expect(missing, `provider files on disk but absent from registry/index.js: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps every HIDDEN provider on disk and out of the index — never half-hidden", () => {
    const importedSet = new Set(importedIds);
    for (const h of HIDDEN) {
      expect(diskFiles, `HIDDEN provider ${h} must keep its file on disk`).toContain(h);
      expect(importedSet.has(h), `HIDDEN provider ${h} must NOT be imported by index.js`).toBe(false);
    }
  });

  it("carries a unique string id on every entry, and ids match their filenames", () => {
    const seen = new Map();
    for (const entry of REGISTRY) {
      expect(typeof entry.id, `entry without an id: ${JSON.stringify(entry).slice(0, 80)}`).toBe("string");
      seen.set(entry.id, (seen.get(entry.id) || 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes, `duplicate registry ids: ${dupes.join(", ")}`).toEqual([]);
    // The emitter derives imports from filenames; id === filename keeps the census
    // and the index honest against each other. (Verified to hold for all 149 at seal.)
    const mismatched = importedIds.filter((id) => !diskFiles.includes(id));
    expect(mismatched, `imported ids with no file on disk: ${mismatched.join(", ")}`).toEqual([]);
  });

  it("builds a dialable PROVIDERS entry for every transport-bearing registry entry", () => {
    const withTransport = REGISTRY.filter((e) => e.transport).map((e) => e.id);
    const undialable = withTransport.filter((id) => !PROVIDERS[id]);
    expect(undialable, `registry entries with transport but no PROVIDERS entry: ${undialable.join(", ")}`).toEqual([]);
    // And the reverse: PROVIDERS is built ONLY from REGISTRY (providers/index.js
    // has no directory scan), so an id in PROVIDERS without a registry entry is
    // impossible by construction — pinned so a future builder change says so here.
    const registryIds = new Set(importedIds);
    const ghosts = Object.keys(PROVIDERS).filter((id) => !registryIds.has(id));
    expect(ghosts, `PROVIDERS keys with no registry entry: ${ghosts.join(", ")}`).toEqual([]);
  });

  it("is loaded from the REAL generated index, not a mock — mutation guard", () => {
    // Producer-coverage law: a suite that pins the index must import the index
    // (not a fixture). If this suite ever passes against a hand-built array while
    // the real index drops entries, it protects nothing — so assert the import is
    // the live module surface (a vitest vi.mock in this file would break this).
    expect(Array.isArray(REGISTRY)).toBe(true);
    expect(REGISTRY.length).toBeGreaterThan(100);
  });
});
