// Test covenant: i18n literals parity — the governance UI's seeded strings.
// Plan: plans/vela-key-governance.md §3.7. W1 seeds English-first placeholders
// into every locale file; this test guards drift on the SEEDED set only (the
// wider locale files have pre-existing uneven coverage that predates W1 and is
// tracked/backfilled separately).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LITERALS_DIR = path.resolve(__dirname, "../../public/i18n/literals");
const SEED_SCRIPT = path.resolve(__dirname, "../../scripts/i18n-seed-literals.mjs");

describe("i18n literals parity (governance strings)", () => {
  it("seed script exports a non-empty governance string list", async () => {
    const mod = await import(SEED_SCRIPT);
    expect(Array.isArray(mod.GOVERNANCE_STRINGS)).toBe(true);
    expect(mod.GOVERNANCE_STRINGS.length).toBeGreaterThan(10);
    expect(typeof mod.listLocaleFiles).toBe("function");
  });

  it("every locale file carries every seeded governance key", async () => {
    const { GOVERNANCE_STRINGS, listLocaleFiles } = await import(SEED_SCRIPT);
    const files = listLocaleFiles();
    expect(files.length).toBeGreaterThanOrEqual(34);

    const problems = [];
    for (const file of files) {
      const map = JSON.parse(fs.readFileSync(path.join(LITERALS_DIR, file), "utf8"));
      for (const str of GOVERNANCE_STRINGS) {
        if (!(str in map)) problems.push(`${file} missing: ${str}`);
      }
    }
    expect(problems, problems.slice(0, 10).join("\n")).toEqual([]);
  });

  it("locale files remain valid JSON objects (seed never corrupts)", () => {
    const files = fs.readdirSync(LITERALS_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(LITERALS_DIR, file), "utf8"));
      expect(parsed).toBeTypeOf("object");
      expect(Array.isArray(parsed)).toBe(false);
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
    }
  });

  it("enforcement-site census matches the baseline (ACL tripwire)", async () => {
    // The committed baseline is the tripwire; this re-derives the live census
    // and compares. Regenerate intentionally with snapshot-apikey-enforcement.mjs.
    const baseline = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../__baseline__/apikey-enforcement-sites.json"), "utf8")
    );
    expect(Array.isArray(baseline.sites)).toBe(true);
    expect(baseline.sites.length).toBeGreaterThanOrEqual(10);

    // Every baseline site must still call authorizeApiRequest with matching flags
    const repoRoot = path.resolve(__dirname, "../..");
    for (const site of baseline.sites) {
      const file = path.join(repoRoot, site.file);
      expect(fs.existsSync(file), `missing enforcement site: ${site.file}`).toBe(true);
      const text = fs.readFileSync(file, "utf8");
      expect(text).toContain("authorizeApiRequest(");
      const callLine = text.split("\n").find((l) => l.includes("authorizeApiRequest(request"));
      expect(!!callLine).toBe(true);
      expect(/allowInternal:\s*true/.test(callLine)).toBe(site.allowInternal);
      expect(/comboModels:/.test(callLine)).toBe(site.comboModels);
    }

    // And no NEW enforcement site exists outside the baseline.
    // Filesystem walk (portable, no shell) replaces the earlier grep.
    const listed = new Set(baseline.sites.map((s) => s.file));
    const srcDir = path.join(repoRoot, "src");
    function walk(dir) {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith(".js")) out.push(full);
      }
      return out;
    }
    const extra = [];
    for (const file of walk(srcDir)) {
      const rel = path.relative(repoRoot, file).split(path.sep).join("/");
      if (rel === "src/sse/services/keyGate.js") continue;
      if (fs.readFileSync(file, "utf8").includes("authorizeApiRequest(")) {
        if (!listed.has(rel)) extra.push(rel);
      }
    }
    expect(extra, `unenlisted enforcement sites: ${extra.join(", ")}`).toEqual([]);
  });
});
