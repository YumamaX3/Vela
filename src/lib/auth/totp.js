// TOTP (RFC 6238) — the second lock on the dashboard's door.
//
// WHY THIS FILE CARRIES ITS OWN ARITHMETIC: Vela runs env-free. There is no
// service to dial and no dependency to install — RFC 4226 (HOTP) is one HMAC
// and a truncation, and RFC 6238 is that HOTP with a time counter. Both are
// written here, on node:crypto alone, so the gate ships in the same artifact
// as the rest of the harbor and never depends on a third party to say a code
// is right. The RFC's own test vectors are asserted in
// tests/unit/totp-rfc6238.test.js — the arithmetic is proven, not trusted.
//
// WHAT THIS MODULE IS NOT: it does not store secrets, decide whether an
// operator enrolled, or mint sessions. It answers one question — "does this
// six-digit code belong to this secret at this moment?" — and every caller
// around it (enroll, verify, login) keeps its own law (usersRepo for storage,
// the route for sessions). The core stays quiet; the tide stays clear.
//
// SECRET SHAPE: RFC 4226 recommends 160 bits (20 bytes) — HMAC-SHA1's own block
// input size, the strength the RFC test vectors were minted against. Secrets
// travel as base32 (RFC 4648) because that is what authenticator apps read
// from an otpauth:// URI, and the QR payload is exactly that URI.

import crypto from "node:crypto";

// ─── Base32 (RFC 4648, unpadded, case-insensitive on decode) ─────────────
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B32_LOOKUP = (() => {
  const m = new Map();
  for (let i = 0; i < B32_ALPHABET.length; i++) m.set(B32_ALPHABET[i], i);
  return m;
})();

/** Encode bytes → base32, no padding. The shape authenticator apps expect. */
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decode base32 → Buffer. Whitespace, '=' padding and lowercase are tolerated
 * (an operator may paste a secret back out of an app); anything else outside the
 * RFC 4648 alphabet is a hard throw — a mangled secret must never silently
 * decode to a DIFFERENT secret and then mint a valid-looking code against it.
 */
export function base32Decode(str) {
  if (typeof str !== "string") throw new TypeError("base32Decode: expected a string");
  const clean = str.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const v = B32_LOOKUP.get(ch);
    if (v === undefined) throw new Error(`base32Decode: illegal character '${ch}'`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ─── The arithmetic (RFC 4226 §5.3, RFC 6238 §4) ──────────────────────────

/** Mint a fresh 160-bit secret as base32 (the enrollment door's one source). */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** The counter an instant belongs to, at `step` seconds (RFC 6238's T = (now - T0)/X). */
export function counterAt(timeMs, step = 30) {
  return Math.floor(timeMs / 1000 / step);
}

/**
 * HOTP for one counter (RFC 4226 §5.3). Exported because the RFC's own vectors
 * are HOTP vectors and proving them directly is cleaner than proving them
 * through a time shim.
 */
export function hotp(secretBase32, counter, { digits = 6, algorithm = "sha1" } = {}) {
  if (!Number.isInteger(counter) || counter < 0) throw new RangeError("hotp: counter must be a non-negative integer");
  const key = Buffer.isBuffer(secretBase32) ? secretBase32 : base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter, without losing precision above 2^32.
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(algorithm, key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** TOTP for an instant (RFC 6238). Defaults are the widely-supported 6 digits / 30s / SHA-1. */
export function totp(secretBase32, timeMs = Date.now(), { digits = 6, step = 30, algorithm = "sha1" } = {}) {
  return hotp(secretBase32, counterAt(timeMs, step), { digits, algorithm });
}

/**
 * Verify a submitted code against a secret, allowing ±`window` steps of clock
 * drift (RFC 6238 §5.2's guideline; the usual one). The comparison is
 * CONSTANT-TIME — a timing oracle on a six-digit code is a slower brute force,
 * but a brute force nonetheless, and the house already owns the comparator.
 *
 * Returns { ok, step } where `step` is the exact counter that matched (the
 * caller keeps it to refuse REPLAYS of the same code inside its drift window).
 */
export function verifyTotp(secretBase32, code, timeMs = Date.now(), { digits = 6, step = 30, algorithm = "sha1", window = 1 } = {}) {
  const submitted = String(code ?? "").trim();
  if (!new RegExp(`^\\d{${digits}}$`).test(submitted)) return { ok: false, step: null };
  const centre = counterAt(timeMs, step);
  let matched = null;
  for (let delta = -window; delta <= window; delta++) {
    const counter = centre + delta;
    if (counter < 0) continue;
    const expected = hotp(secretBase32, counter, { digits, algorithm });
    // Every candidate is compared, never short-circuited on the first match's
    // position — the loop count must not depend on WHICH step matched.
    const hit = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(submitted));
    if (hit) matched = counter;
  }
  return { ok: matched !== null, step: matched };
}

/**
 * The otpauth:// URI an authenticator app reads from a QR code (Key URI Format,
 * the convention every TOTP app agrees on). No external service renders it:
 * the dashboard shows the URI as text, and the operator's own app scans or the
 * operator's own QR viewer renders it locally. That is the env-free promise.
 */
export function otpauthUri({ secret, account = "admin", issuer = "Vela", digits = 6, step = 30, algorithm = "sha1" }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: algorithm.toUpperCase(),
    digits: String(digits),
    period: String(step),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
