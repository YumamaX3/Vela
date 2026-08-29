/**
 * Unit tests for the update truth-source (v0.9.32 — The Horizon Bell).
 *
 * The notice must ring TRUE: strict semver tags only (retreat markers and
 * prereleases never count), honest changelog extraction, and the right
 * update command for each deployment berth.
 */

import { describe, it, expect } from "vitest";
import {
  parseTagVersion,
  compareVersions,
  extractChangelogSection,
  detectDeployment,
  updateCommandFor,
} from "@/lib/updateInfo";

describe("parseTagVersion — strict semver only", () => {
  it("accepts plain v-prefixed semver", () => {
    expect(parseTagVersion("v0.9.31")).toBe("0.9.31");
    expect(parseTagVersion("v1.0.0")).toBe("1.0.0");
  });

  it("accepts unprefixed semver", () => {
    expect(parseTagVersion("0.9.30")).toBe("0.9.30");
  });

  it("rejects retreat markers (v0.9.27-retreat must never count as latest)", () => {
    expect(parseTagVersion("v0.9.27-retreat")).toBeNull();
  });

  it("rejects prereleases and malformed tags", () => {
    expect(parseTagVersion("v1.0.0-beta.1")).toBeNull();
    expect(parseTagVersion("v1.0")).toBeNull();
    expect(parseTagVersion("")).toBeNull();
    expect(parseTagVersion(null)).toBeNull();
    expect(parseTagVersion(123)).toBeNull();
  });
});

describe("compareVersions — the ordering law", () => {
  it("orders three-part versions numerically", () => {
    expect(compareVersions("0.9.31", "0.9.30")).toBe(1);
    expect(compareVersions("0.9.30", "0.9.31")).toBe(-1);
    expect(compareVersions("0.9.30", "0.9.30")).toBe(0);
  });

  it("does not string-compare (0.9.9 < 0.9.10 numerically)", () => {
    expect(compareVersions("0.9.9", "0.9.10")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.99")).toBe(1);
  });

  it("treats missing parts as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("extractChangelogSection — one verse of the ship's log", () => {
  const SAMPLE = [
    "# ⛵ Vela — The Ship's Log",
    "",
    "preamble text",
    "",
    "---",
    "",
    "# v0.9.31 — The Mended Lines ⛵",
    "",
    "> epigraph",
    "",
    "- first bullet",
    "- second bullet",
    "",
    "---",
    "",
    "# v0.9.30 — The Honest Gate ⚖️",
    "",
    "older verse body",
    "",
  ].join("\n");

  it("extracts the newest verse (until the next heading)", () => {
    const section = extractChangelogSection(SAMPLE, "0.9.31");
    // The body after the heading — the heading itself is already named in
    // the notice banner, so the section is the epigraph + bullets.
    expect(section).toContain("epigraph");
    expect(section).toContain("first bullet");
    expect(section).toContain("second bullet");
    expect(section).not.toContain("The Honest Gate");
  });

  it("extracts the last verse when no heading follows", () => {
    const section = extractChangelogSection(SAMPLE, "0.9.30");
    expect(section).toContain("older verse body");
  });

  it("returns empty for an absent version", () => {
    expect(extractChangelogSection(SAMPLE, "0.9.99")).toBe("");
  });

  it("is safe on empty or malformed input", () => {
    expect(extractChangelogSection("", "0.9.31")).toBe("");
    expect(extractChangelogSection(null, "0.9.31")).toBe("");
    expect(extractChangelogSection(SAMPLE, null)).toBe("");
  });

  it("matches the v-prefix header form too", () => {
    expect(extractChangelogSection(SAMPLE, "v0.9.31")).toContain("first bullet");
  });

  it("does not treat regex metacharacters in the version as wildcards", () => {
    // A version like 0.9.31 must not match a hypothetical 0x9y31 heading.
    expect(extractChangelogSection("# v0x9y31\n\nbody", "0.9.31")).toBe("");
  });
});

describe("detectDeployment — which berth does Vela sleep in", () => {
  it("returns a known berth label", () => {
    const d = detectDeployment();
    expect(["docker", "k8s", "npm", "dev"]).toContain(d);
  });
});

describe("updateCommandFor — the right command for each berth", () => {
  it("hands the docker compose command for docker", () => {
    expect(updateCommandFor("docker")).toContain("docker compose pull");
    expect(updateCommandFor("docker")).toContain("up -d");
  });

  it("names the image-tag path for k8s", () => {
    expect(updateCommandFor("k8s")).toContain("ghcr.io/yumamax3/vela");
  });

  it("hands the npm install command for the CLI berth", () => {
    expect(updateCommandFor("npm")).toContain("npm i -g");
  });

  it("hands no command for dev (nothing to update)", () => {
    expect(updateCommandFor("dev")).toBe("");
  });
});
