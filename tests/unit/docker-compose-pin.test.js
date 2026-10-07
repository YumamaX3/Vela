// The Star's decree, and the guard that keeps it.
//
// CLAUDE.md's "Release a minor" rite carries a line that is easy to read and
// easy to skip: "⚠️ ALSO bump the image pin in BOTH docker-compose.example.yml
// (tracked) AND docker-compose.yml (gitignored, on disk) — the Star's decree:
// every update sails both charts."
//
// It was skipped exactly once, in v0.9.75: the release shipped with both charts
// still pinned to 0.9.74 while package.json said 0.9.75. Measured history shows
// the five tides before it (v0.9.70 … v0.9.74) all matched, so the rite was
// sound — what was missing was an INSTRUMENT. A decree carried only in prose
// and memory is forgotten again; this file is the instrument.
//
// Two invariants, both about the same three files:
//
//   1. THE PIN FOLLOWS THE RELEASE. The tracked template's vela image tag must
//      equal package.json's version. This is the one that would have caught the
//      v0.9.75 miss, and it runs on every host and in CI.
//
//   2. THE SECRET-BEARING CHART IS NEVER TRACKED. docker-compose.yml holds the
//      Shores' inline secrets and the repo is PUBLIC. On 2026-09-19 it was
//      committed once (513dadab) on the belief the repo was private, and four
//      secrets sat readable for over a month. It is gitignored now. This test
//      asserts the ignore entry is still there — delete it and the chart can be
//      staged by a careless `git add -A`, which is how it leaked the first time.
//
// The live chart (docker-compose.yml) is UNTRACKED and absent on a fresh clone,
// so its pin is checked only when the file exists on disk — the second half of
// "sail both charts" for the host that actually deploys.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATE = path.join(ROOT, "docker-compose.example.yml");
const LIVE = path.join(ROOT, "docker-compose.yml");
const GITIGNORE = path.join(ROOT, ".gitignore");
const PKG = path.join(ROOT, "package.json");

/** The vela image pin from a chart, ignoring comment lines. */
function velaPin(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (line.trimStart().startsWith("#")) continue;
    const m = line.match(/image:\s*ghcr\.io\/yumamax3\/vela:([0-9]+\.[0-9]+\.[0-9]+)/);
    if (m) return m[1];
  }
  return null;
}

const pkgVersion = JSON.parse(fs.readFileSync(PKG, "utf8")).version;

describe("the image pin follows the release (the Star's decree)", () => {
  it("the tracked template pins the version package.json declares", () => {
    expect(velaPin(TEMPLATE)).toBe(pkgVersion);
  });

  it("every release TAG from v1.0.71 onward carries a chart pin equal to its own version (history law)", () => {
    // The v0.9.75 guard compares working tree to working tree; it cannot see a
    // release where the COMMITTED chart never moved. That miss happened again
    // in v1.0.70: package.json said 1.0.70 but the committed example chart
    // still pinned 1.0.69, so every `docker-compose.example.yml` deployment
    // pulled the wrong image. This assertion reads HISTORY instead of disk:
    // for each release tag, extract both the chart's vela pin and
    // package.json's version from that tag's tree and require them equal.
    //
    // BOUNDED, NOT BLIND: v1.0.70 and older are FROZEN — pushed, built, and
    // sailing on the fleet — and rewriting a pushed release tag would
    // desync the published image from the tag that names it. Their conviction
    // is recorded (v1.0.70: chart=1.0.69 vs package.json=1.0.70; the mend
    // rode v1.0.71). The law therefore binds from the FIRST tag that carries
    // this guard (v1.0.71) forward, so the next forgetful release fails here.
    const FIRST_BOUND_TAG = "v1.0.71";
    const { execSync } = require("node:child_process");
    const tags = execSync('git tag -l "v*"', { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    // Version-order the tags, keep those at or after the bound.
    const key = (t) => t.replace(/^v/, "").split(".").map(Number);
    const bound = key(FIRST_BOUND_TAG);
    const boundTags = tags
      .filter((t) => {
        const [a, b, c] = key(t);
        const [x, y, z] = bound;
        return a > x || (a === x && (b > y || (b === y && c >= z)));
      });
    expect(
      boundTags,
      `no tags at or after ${FIRST_BOUND_TAG} found — the history law has no jurisdiction`
    ).toContain(FIRST_BOUND_TAG);
    const mismatches = [];
    for (const tag of boundTags) {
      const chart = execSync(`git show ${tag}:docker-compose.example.yml`, { cwd: ROOT, encoding: "utf8" });
      const pin = chart
        .split(/\r?\n/)
        .filter((l) => !l.trimStart().startsWith("#"))
        .map((l) => l.match(/image:\s*ghcr\.io\/yumamax3\/vela:([0-9]+\.[0-9]+\.[0-9]+)/))
        .filter(Boolean)
        .map((m) => m[1])[0];
      const pkgRaw = execSync(`git show ${tag}:package.json`, { cwd: ROOT, encoding: "utf8" });
      const version = JSON.parse(pkgRaw).version;
      if (pin !== version) mismatches.push(`${tag}: chart=${pin} package.json=${version}`);
    }
    expect(
      mismatches,
      `release tags whose committed chart pin does not match their own version: ${mismatches.join("; ")} — every deployment from the example chart pulled the wrong image`
    ).toEqual([]);
  });

  it("the template is tracked, not ignored — it is the chart that ships", () => {
    expect(fs.existsSync(TEMPLATE)).toBe(true);
    const ignored = fs
      .readFileSync(GITIGNORE, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(ignored).not.toContain("docker-compose.example.yml");
  });

  it("the live chart, when present, pins the same version (sail both charts)", () => {
    if (!fs.existsSync(LIVE)) return; // absent on a fresh clone — nothing to check
    expect(velaPin(LIVE)).toBe(pkgVersion);
  });
});

describe("the secret-bearing chart is never tracked", () => {
  it("docker-compose.yml is named in .gitignore", () => {
    const ignored = fs
      .readFileSync(GITIGNORE, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(ignored).toContain("docker-compose.yml");
  });
});
