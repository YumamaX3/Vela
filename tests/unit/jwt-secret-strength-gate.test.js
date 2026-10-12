// tests/unit/jwt-secret-strength-gate.test.js — H2 MEND (full-deep audit,
// 2026-10-11). loadJwtSecret used to accept ANY non-empty JWT_SECRET —
// including the compose example's own "set-me-64-hex-chars" placeholder. A
// publicly known signing key makes every dashboard cookie forgeable. The gate
// now refuses placeholder shapes and low-entropy/short secrets LOUD, while
// the unset path (random 32-byte file, 0600) is unchanged.
//
// The gate lives in loadJwtSecret's env branch, exercised through the module:
// importing with a weak secret must THROW at module eval; a strong secret (or
// none at all, with a temp DATA_DIR) must mint normally.
//
// Every literal below is an EXAMPLE fixture (never a credential) — marked so
// the cargo gate reads them as the placeholders they are.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalSecret = process.env.JWT_SECRET;
const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-h2-jwt-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.JWT_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

// The session module caches SECRET at eval; each case re-imports it fresh.
async function importSessionModule() {
  vi.resetModules();
  return await import("../../src/lib/auth/dashboardSession.js");
}

// EXAMPLE fixture (never a credential): the documented 64-hex shape.
const STRONG_EXAMPLE = "0123456789abcdef".repeat(4);

describe("JWT_SECRET strength gate (H2 — refuse placeholder/weak signing keys)", () => {
  it("refuses the compose example's own placeholder", async () => {
    process.env.JWT_SECRET = "set-me-64-hex-chars"; // EXAMPLE placeholder
    await expect(importSessionModule()).rejects.toThrow(/JWT_SECRET/);
    await expect(importSessionModule()).rejects.toThrow(/placeholder|weak/i);
  });

  it("refuses every known placeholder shape case-insensitively", async () => {
    // EXAMPLE placeholders, each a shape the gate must refuse:
    for (const p of ["set-me", "CHANGE-ME", "changeme", "please-change-me"]) {
      process.env.JWT_SECRET = p;
      await expect(importSessionModule()).rejects.toThrow(/JWT_SECRET/);
    }
  });

  it("refuses a short secret (<32 chars) even when not a known placeholder", async () => {
    process.env.JWT_SECRET = "short-but-plausible-secret"; // EXAMPLE: 26 chars
    await expect(importSessionModule()).rejects.toThrow(/JWT_SECRET/);
  });

  it("refuses a 32+ char secret that is one repeated character", async () => {
    process.env.JWT_SECRET = "a".repeat(64); // EXAMPLE low-entropy shape
    await expect(importSessionModule()).rejects.toThrow(/JWT_SECRET/);
  });

  it("refuses a 32+ char secret with too few distinct characters", async () => {
    process.env.JWT_SECRET = "ab".repeat(32); // EXAMPLE: 64 chars, 2 distinct
    await expect(importSessionModule()).rejects.toThrow(/JWT_SECRET/);
  });

  it("admits a real 64-hex secret", async () => {
    process.env.JWT_SECRET = STRONG_EXAMPLE; // EXAMPLE fixture
    const mod = await importSessionModule();
    expect(typeof mod.createDashboardAuthToken).toBe("function");
    const token = await mod.createDashboardAuthToken({});
    expect(typeof token).toBe("string");
  });

  it("admits a 32-char secret with 12+ distinct characters", async () => {
    process.env.JWT_SECRET = "abcdefghijklmnopqrstuvwxyz012345"; // EXAMPLE fixture
    const mod = await importSessionModule();
    const token = await mod.createDashboardAuthToken({});
    expect(typeof token).toBe("string");
  });

  it("unset JWT_SECRET falls back to a generated secret file", async () => {
    delete process.env.JWT_SECRET;
    const mod = await importSessionModule();
    const token = await mod.createDashboardAuthToken({});
    expect(typeof token).toBe("string");
    const secretFile = path.join(tempDir, "jwt-secret");
    expect(fs.existsSync(secretFile)).toBe(true);
    // The generated secret's strength is the proof (64 hex), not the mode bit
    // (Windows maps 0600 loosely).
    expect(fs.readFileSync(secretFile, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
  });
});
