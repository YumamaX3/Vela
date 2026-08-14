// Test covenant: apikey-format — round-trip, tamper, CRC timing-safe, sk- rejection.
// Plan: plans/vela-key-governance.md §7.
import { describe, it, expect, beforeEach, vi } from "vitest";

const SECRET = "test-secret-for-format-suite";
const originalEnv = process.env.API_KEY_SECRET;

beforeEach(() => {
  vi.resetModules();
  process.env.API_KEY_SECRET = SECRET;
});

afterAll(() => {
  if (originalEnv === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalEnv;
});

describe("Vela key format (vela-v1-{keyId}-{crc})", () => {
  it("generateApiKey → round-trips through parseVelaKey", async () => {
    const { generateApiKey, parseVelaKey } = await import("@/shared/utils/apiKey.js");
    const { key, keyId } = generateApiKey();
    expect(key).toMatch(/^vela-v1-[0-9a-f]{32}-[0-9a-f]{8}$/);
    const parsed = parseVelaKey(key);
    expect(parsed).toEqual({ keyId, version: "v1" });
  });

  it("generateApiKey → unique keyId + key across mints", async () => {
    const { generateApiKey } = await import("@/shared/utils/apiKey.js");
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.keyId).not.toBe(b.keyId);
    expect(a.key).not.toBe(b.key);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it("hashKey is SHA-256 hex of the full key", async () => {
    const { generateApiKey, hashKey } = await import("@/shared/utils/apiKey.js");
    const { key, keyHash } = generateApiKey();
    expect(hashKey(key)).toBe(keyHash);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects every sk- legacy shape (hard clean break)", async () => {
    const { parseVelaKey } = await import("@/shared/utils/apiKey.js");
    const legacy = ["sk_9router", "sk-proj-abc123", "sk-1234abcd", "SK-V1-ABC-DEF", "sk-live-xyz"];
    for (const k of legacy) {
      expect(parseVelaKey(k)).toBeNull();
    }
  });

  it("rejects malformed vela keys", async () => {
    const { parseVelaKey, generateApiKey } = await import("@/shared/utils/apiKey.js");
    const valid = generateApiKey().key;
    expect(parseVelaKey(valid)).not.toBeNull();

    const tampered = [
      "",                                  // empty
      null,                                // null
      42,                                  // non-string
      "vela-",                             // prefix only
      "vela-v1",                           // missing segments
      "vela-v2-" + "a".repeat(32) + "-12345678", // wrong version
      "vela-v1-" + "a".repeat(31) + "-12345678", // short keyId
      "vela-v1-" + "a".repeat(33) + "-12345678", // long keyId
      "vela-v1-" + "a".repeat(32) + "-1234567",  // short crc
      "vela-v1-" + "a".repeat(32) + "-123456789", // long crc
      "vela-v1-" + "g".repeat(32) + "-12345678",  // non-hex keyId
      "vela-v1-" + "a".repeat(32) + "-zzzzzzzz",  // non-hex crc
    ];
    for (const k of tampered) expect(parseVelaKey(k)).toBeNull();
  });

  it("CRC tamper is rejected (timing-safe compare)", async () => {
    const { generateApiKey, parseVelaKey } = await import("@/shared/utils/apiKey.js");
    const { key, keyId } = generateApiKey();
    // Flip one nibble of the CRC
    const crc = key.slice(-8);
    const flippedNibble = (parseInt(crc[0], 16) ^ 1).toString(16);
    const tamperedKey = key.slice(0, -8) + flippedNibble + crc.slice(1);
    expect(tamperedKey).not.toBe(key);
    expect(parseVelaKey(tamperedKey)).toBeNull();
    // And a wholly-forged CRC cannot pass
    const forged = `vela-v1-${keyId}-00000000`;
    expect(parseVelaKey(forged)).toBeNull();
  });

  it("CRC changes when API_KEY_SECRET rotates — old keys become unparseable", async () => {
    const { generateApiKey } = await import("@/shared/utils/apiKey.js");
    const { key } = generateApiKey();

    vi.resetModules();
    process.env.API_KEY_SECRET = "rotated-secret";
    const rotated = await import("@/shared/utils/apiKey.js");
    expect(rotated.parseVelaKey(key)).toBeNull(); // old CRC no longer verifies
  });

  it("extractKeyIdLoose reads identity without CRC check", async () => {
    const { generateApiKey, extractKeyIdLoose } = await import("@/shared/utils/apiKey.js");
    const { key, keyId } = generateApiKey();
    expect(extractKeyIdLoose(key)).toBe(keyId);
    // Loose form accepts bad CRC (identity match only)
    const badCrc = key.slice(0, -8) + "00000000";
    expect(extractKeyIdLoose(badCrc)).toBe(keyId);
    expect(extractKeyIdLoose("sk-legacy")).toBeNull();
    expect(extractKeyIdLoose(null)).toBeNull();
  });

  it("displayPrefix is masked and deterministic", async () => {
    const { generateApiKey, displayPrefix } = await import("@/shared/utils/apiKey.js");
    const { keyId } = generateApiKey();
    const prefix = displayPrefix(keyId);
    expect(prefix).toBe(`vela-v1-${keyId.slice(0, 4)}…`);
    expect(prefix).not.toContain(keyId.slice(8)); // never leaks full identity
  });
});
