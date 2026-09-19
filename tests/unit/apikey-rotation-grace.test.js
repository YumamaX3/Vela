// Test covenant: apikey-rotation-grace — a secret rotation must not lock the fleet out.
// Plan: plans/vela-key-governance.md §3.8 + §7. A key's crc binds it to the
// API_KEY_SECRET that minted it, so a rotation makes every stored crc stale. The crc
// is a fast-path pre-reject, NOT the authentication decision — the row's sha256 is.
// These cases pin that a rotated key still resolves, that the documented rotation-grace
// slot is finally reachable, and that malformed / forged / unknown keys still fail closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;
const SECRET_A = "rotation-grace-secret-A";
const SECRET_B = "rotation-grace-secret-B";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-rotation-grace-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = SECRET_A;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

/** The documented rotation procedure: replace the secret, restart the process. */
function rotate(newSecret) {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  process.env.API_KEY_SECRET = newSecret;
  vi.resetModules();
}

async function mint(name) {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  return { created: await createApiKey(name), db };
}

describe("rotation grace — the fleet survives a secret rotation", () => {
  it("a key minted before the rotation resolves after it, by its stored sha256", async () => {
    const { created } = await mint("Fleet Key");
    const before = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(await before.validateApiKey(created.key)).toBe(true);

    rotate(SECRET_B);
    const { parseVelaKey } = await import("@/shared/utils/apiKey.js");
    const after = await import("@/lib/db/repos/apiKeysRepo.js");

    // The crc is stale — the strict parser still refuses it (its own covenant)…
    expect(parseVelaKey(created.key)).toBeNull();
    // …but the row was minted from this exact string and its hash never moved,
    // so the key still authenticates. This is the fleet-restoring contract.
    expect(await after.validateApiKey(created.key)).toBe(true);

    // A key minted under the new secret works on equal footing.
    const fresh = await after.createApiKey("Fresh Key");
    expect(parseVelaKey(fresh.key)).not.toBeNull();
    expect(await after.validateApiKey(fresh.key)).toBe(true);
  });

  it("malformed, forged and unknown keys still fail closed", async () => {
    const { validateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { generateApiKey } = await import("@/shared/utils/apiKey.js");
    const { keyId } = generateApiKey(); // a real identity that has no row

    for (const bad of [
      "sk-legacy-token",                                 // legacy format
      "",                                                // empty
      null,                                              // non-string
      "vela-v1",                                         // missing segments
      "vela-v2-" + "a".repeat(32) + "-12345678",         // wrong version
      "vela-v1-" + "a".repeat(31) + "-12345678",         // short keyId
      "vela-v1-" + "a".repeat(32) + "-zzzzzzzz",         // non-hex crc
      `vela-v1-${keyId}-00000000`,                       // valid shape, forged crc, no row
    ]) {
      expect(await validateApiKey(bad)).toBe(false);
    }
  });

  it("the rotation-grace slot fires for a superseded hash — and only within its window", async () => {
    const { created, db } = await mint("Superseded Key");
    const oldHash = crypto.createHash("sha256").update(created.key).digest("hex");
    const future = new Date(Date.now() + 3600_000).toISOString();
    const past = new Date(Date.now() - 3600_000).toISOString();

    // The shape a re-issued key takes: the live hash is replaced, the previous one
    // is given a grace window. updateApiKey refuses these columns by design, so the
    // row is rewritten directly.
    db.run(
      `UPDATE apiKeys SET keyHash = ?, rotationPrevHash = ?, rotationGraceUntil = ? WHERE id = ?`,
      ["f".repeat(64), oldHash, future, created.keyId]
    );
    const { resolveKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(await resolveKey(created.key)).not.toBeNull();

    // Same row, window expired → rejected.
    db.run(`UPDATE apiKeys SET rotationGraceUntil = ? WHERE id = ?`, [past, created.keyId]);
    expect(await resolveKey(created.key)).toBeNull();

    // No window at all → rejected: the grace branch is what admitted it.
    db.run(
      `UPDATE apiKeys SET rotationPrevHash = NULL, rotationGraceUntil = NULL WHERE id = ?`,
      [created.keyId]
    );
    expect(await resolveKey(created.key)).toBeNull();
  });
});
