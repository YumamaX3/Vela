// Backup codes — the second lock's emergency key ring.
//
// Ten codes, shown ONCE, each single-use. High-entropy random values (80 bits)
// are hashed with a single SHA-256 rather than a slow KDF: the second login
// step must answer in milliseconds, and brute-forcing 80 bits of randomness is
// not a threat this design defends against — losing the sheet of paper is.
//
// The set is stored as a JSON array of hex digests. Verification consumes a
// code by REMOVING its digest, so a used code can never be replayed, and the
// remaining count is the array's length — there is no second bookkeeping
// column to drift from the truth.
import crypto from "node:crypto";

const CODE_BYTES = 10; // 80 bits
const CODE_COUNT = 10;
// Crockford-ish alphabet: no I, L, O, U, or 0/1 — a code read aloud or copied
// off paper must not be ambiguous.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** One code, e.g. "K7QM-2XTB-9FPR". Grouped for reading, not for parsing. */
export function generateBackupCode() {
  const bytes = crypto.randomBytes(CODE_BYTES);
  let out = "";
  for (let i = 0; i < CODE_BYTES; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return [out.slice(0, 4), out.slice(4, 8), out.slice(8)].join("-");
}

export function hashCode(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

/**
 * How many unspent codes the stored set still holds. The count an operator
 * should see — a SET is opaque until its size is asked for, and verification
 * removes digests, so the length IS the truth. A malformed row reads as 0.
 */
export function countBackupCodes(storedJson) {
  if (!storedJson) return 0;
  try {
    const hashes = JSON.parse(storedJson);
    return Array.isArray(hashes) ? hashes.length : 0;
  } catch {
    return 0;
  }
}

/** A fresh set: the PLAINTEXT codes for the operator, and the digests for the row. */
export function mintBackupCodes(count = CODE_COUNT) {
  const codes = Array.from({ length: count }, generateBackupCode);
  return { codes, hashes: codes.map(hashCode) };
}

/**
 * Try one code against a stored digest set.
 * Returns { ok, remaining } — ok consumes the code, remaining is the digest
 * count after the attempt (the count an operator should see).
 * A malformed stored set reads as "no codes", never as a crash.
 */
export function verifyBackupCode(storedJson, code) {
  let hashes;
  try {
    hashes = JSON.parse(storedJson || "[]");
    if (!Array.isArray(hashes)) hashes = [];
  } catch {
    return { ok: false, remaining: 0 };
  }
  const candidate = hashCode(code);
  const idx = hashes.indexOf(candidate);
  if (idx === -1) return { ok: false, remaining: hashes.length };
  hashes.splice(idx, 1);
  return { ok: true, remaining: hashes.length, hashes };
}
