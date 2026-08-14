// Test covenant: apikey-secret-lifecycle — auto-generation, env precedence,
// rotation as the global revocation lever.
// Plan: plans/vela-key-governance.md §3.8 + §7.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-secret-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.API_KEY_SECRET;
  vi.resetModules();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

describe("API_KEY_SECRET lifecycle", () => {
  it("auto-generates a 256-bit secret under DATA_DIR on first use", async () => {
    const { getApiKeySecret } = await import("@/shared/utils/apiKey.js");
    const secret = getApiKeySecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex

    const file = path.join(tempDir, "api-key-secret");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8").trim()).toBe(secret);
  });

  it("is stable across calls (cached) and across reloads from file", async () => {
    const first = (await import("@/shared/utils/apiKey.js")).getApiKeySecret();

    vi.resetModules(); // simulate process restart — secret must come from the file
    const second = (await import("@/shared/utils/apiKey.js")).getApiKeySecret();
    expect(second).toBe(first);
  });

  it("env var takes precedence over the file", async () => {
    const { getApiKeySecret } = await import("@/shared/utils/apiKey.js");
    const fileSecret = getApiKeySecret(); // writes the file

    vi.resetModules();
    process.env.API_KEY_SECRET = "env-override-secret";
    const envSecret = (await import("@/shared/utils/apiKey.js")).getApiKeySecret();
    expect(envSecret).toBe("env-override-secret");
    expect(envSecret).not.toBe(fileSecret);
  });

  it("rotating the secret revokes every minted key (global lever)", async () => {
    // Mint under secret A
    process.env.API_KEY_SECRET = "secret-A";
    const { generateApiKey, parseVelaKey } = await import("@/shared/utils/apiKey.js");
    const minted = generateApiKey();
    expect(parseVelaKey(minted.key)).not.toBeNull();

    // Rotate to secret B (replace env/file + restart = the documented procedure)
    vi.resetModules();
    process.env.API_KEY_SECRET = "secret-B";
    const rotated = await import("@/shared/utils/apiKey.js");

    // Old key's CRC no longer verifies under the new root → rejected everywhere
    expect(rotated.parseVelaKey(minted.key)).toBeNull();
    // New mints under B verify fine
    const fresh = rotated.generateApiKey();
    expect(rotated.parseVelaKey(fresh.key)).not.toBeNull();
  });

  it("there is no hardcoded fallback secret (public default would forge CRCs)", async () => {
    // With env unset and no file, the first read GENERATES — it never returns a constant.
    const { getApiKeySecret } = await import("@/shared/utils/apiKey.js");
    const s1 = getApiKeySecret();

    vi.resetModules();
    fs.rmSync(path.join(tempDir, "api-key-secret"), { force: true }); // wipe the file
    const s2 = (await import("@/shared/utils/apiKey.js")).getApiKeySecret();
    expect(s1).not.toBe(s2); // two fresh installs yield different secrets
  });
});
