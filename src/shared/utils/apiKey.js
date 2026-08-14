import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

/**
 * Vela API key format — vela-v1-{keyId}-{crc}   (plan: plans/vela-key-governance.md §3.1)
 *
 * - keyId: 128-bit CSPRNG (32 hex chars) — row PRIMARY KEY + non-secret attribution id
 * - crc:   8 hex of HMAC-SHA256(API_KEY_SECRET, "v1." + keyId) — typo filter + stateless
 *          pre-reject, compared timing-safe. Rotating API_KEY_SECRET revokes every key.
 * - No machineId. No sk- format — legacy keys are rejected everywhere.
 * - Full keys are shown once (201) and stored ONLY as SHA-256 hashes (apiKeysRepo).
 *   128-bit entropy makes unpeppered SHA-256 rainbow-infeasible (no salt needed).
 */
export const KEY_VERSION = "v1";
const KEY_PREFIX = "vela-";

/**
 * The HMAC root. Env wins; otherwise a per-install 256-bit secret is generated
 * under DATA_DIR/api-key-secret (0600) on first use. There is NO hardcoded
 * fallback — a public default would make every CRC forgeable.
 * Rotating the secret rotates (invalidates) every minted key at once:
 * replace the env var / file, restart. Loss of the secret = total lockout;
 * the file ships in the backup bundle contract for this reason.
 */
let cachedSecret = null;
export function getApiKeySecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.API_KEY_SECRET) {
    cachedSecret = process.env.API_KEY_SECRET;
    return cachedSecret;
  }
  const file = path.join(DATA_DIR, "api-key-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
    return cachedSecret;
  } catch {}
  const generated = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, generated, { mode: 0o600 });
  cachedSecret = generated;
  return cachedSecret;
}

function computeCrc(keyId) {
  return crypto
    .createHmac("sha256", getApiKeySecret())
    .update(`${KEY_VERSION}.${keyId}`)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate a fresh Vela API key.
 * @returns {{ key: string, keyId: string, keyHash: string, keyPrefix: string }}
 */
export function generateApiKey() {
  const keyId = crypto.randomBytes(16).toString("hex"); // 128-bit
  const key = `${KEY_PREFIX}${KEY_VERSION}-${keyId}-${computeCrc(keyId)}`;
  return { key, keyId, keyHash: hashKey(key), keyPrefix: displayPrefix(keyId) };
}

/**
 * Derive an internal-purpose key deterministically (e.g. MITM child process).
 * The full key is recomputable at every boot from API_KEY_SECRET and stored
 * nowhere — the sanctioned exception to show-once (plan §3.6).
 * Rotating API_KEY_SECRET rotates internal keys too.
 */
export function deriveInternalKey(purpose) {
  const keyId = crypto
    .createHmac("sha256", getApiKeySecret())
    .update(`internal:${purpose}`)
    .digest("hex")
    .slice(0, 32);
  const key = `${KEY_PREFIX}${KEY_VERSION}-${keyId}-${computeCrc(keyId)}`;
  return { key, keyId, keyHash: hashKey(key), keyPrefix: displayPrefix(keyId) };
}

/**
 * Strict parser — accepts ONLY the current vela format, rejects sk- and
 * anything malformed. CRC is verified timing-safe.
 * @returns {{ keyId: string, version: string } | null}
 */
export function parseVelaKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey.startsWith(KEY_PREFIX)) return null;
  const body = apiKey.slice(KEY_PREFIX.length);
  const parts = body.split("-");
  if (parts.length !== 3) return null;
  const [version, keyId, crc] = parts;
  if (version !== KEY_VERSION) return null;
  if (!/^[0-9a-f]{32}$/.test(keyId)) return null;
  if (!/^[0-9a-f]{8}$/.test(crc)) return null;
  const expected = computeCrc(keyId);
  const a = Buffer.from(crc, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { keyId, version };
}

/** SHA-256 hex of the full key — the at-rest identity (show-once contract). */
export function hashKey(fullKey) {
  return crypto.createHash("sha256").update(fullKey).digest("hex");
}

/** Display prefix for lists/logs — e.g. "vela-v1-ab3f…" — never secret material. */
export function displayPrefix(keyId) {
  return `${KEY_PREFIX}${KEY_VERSION}-${keyId.slice(0, 4)}…`;
}

/** Extract the keyId from a vela key WITHOUT CRC verification (identity match only). */
export function extractKeyIdLoose(apiKey) {
  if (typeof apiKey !== "string" || !apiKey.startsWith(KEY_PREFIX)) return null;
  const parts = apiKey.slice(KEY_PREFIX.length).split("-");
  if (parts.length !== 3) return null;
  return /^[0-9a-f]{32}$/.test(parts[1]) ? parts[1] : null;
}
