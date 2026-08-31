import crypto from "node:crypto";

/**
 * Constant-time secret comparison — the house pattern (see
 * src/shared/utils/apiKey.js parseVelaKey): SHA-256 both sides so unequal
 * lengths digest to equal-sized buffers, check byteLength equality FIRST,
 * then crypto.timingSafeEqual. Absent/empty inputs reject before any
 * comparison. Never throws on odd input — callers get a plain `false`.
 *
 * Digesting first also keeps the compare timing independent of where a
 * mismatch sits in the raw strings.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!a || !b) return false;
  const digestA = crypto.createHash("sha256").update(a).digest();
  const digestB = crypto.createHash("sha256").update(b).digest();
  if (digestA.byteLength !== digestB.byteLength) return false;
  return crypto.timingSafeEqual(digestA, digestB);
}
