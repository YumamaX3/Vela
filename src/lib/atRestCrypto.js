// AT-REST CREDENTIAL ENCRYPTION — the self-describing envelope.
//
// Ported from 9Router Pro's `atRestCrypto.js`. Everything that must survive
// here is stated in one place, because every other file only consumes it:
//
//   • ONE key, ONE algorithm. AES-256-GCM over a single UTF-8 string; the key
//     comes from CREDENTIAL_ENCRYPTION_KEY and may be written as 64 hex
//     characters or as standard base64 that decodes to exactly 32 bytes.
//   • THE ENVELOPE IS SELF-DESCRIBING. Sealed values are JSON objects
//     `{ v: 1, iv, tag, data }` — every member standard base64. The GCM tag is
//     the proof: an envelope that authenticates IS one of ours; a value that
//     does not parse as an envelope, or that cannot exist under v1's fixed
//     iv/tag lengths, is simply not encrypted yet. That is the whole reason
//     migration 028 does not exist: legacy plaintext and sealed ciphertext
//     are distinguishable from the value alone, with no column, no marker,
//     and no per-row flag to keep in step with the data.
//   • NO KEY IS NOT AN ERROR. Without a key, writes stay plaintext and reads
//     pass through untouched — an install that never sets the variable keeps
//     working exactly as before. With a key, seal-on-write and open-on-read
//     happen transparently; values already sealed stay sealed.
//   • A DECRYPT FAILURE NEVER TAKES A READ DOWN. Bad tag, wrong key, truncated
//     body, an envelope whose fields were replaced with numbers — each one
//     writes a single audit line (via the caller's onError) and returns the
//     RAW stored value. The caller keeps its row; the operator gets a trail.
//   • THE KEY IS NEVER LOGGED. Not on success, not on failure, not in errors.
//     Error messages name the fault, never the material.
//
// The escape hatch for a value that merely LOOKS sealed (a user pasting an
// object of exactly that shape as a credential) is a backward-compatible
// one: a string payload may be prefixed with PRE_ENCRYPTED_PREFIX to say "this
// is opaque bytes I already encrypted — stow it as ciphertext bytes". Callers
// that hand a raw string never need it.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const AT_REST_KEY_ENV = "CREDENTIAL_ENCRYPTION_KEY";
export const ENVELOPE_VERSION = 1;
export const ALGO = "aes-256-gcm";
export const KEY_SIZE = 32;
const IV_SIZE = 12;
const TAG_SIZE = 16;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Mark a string payload as already-encrypted bytes (see the header). */
export const PRE_ENCRYPTED_PREFIX = "b64:";

export const ERR_ENVELOPE_UNREADABLE = "AT_REST_ENVELOPE_UNREADABLE";

export class AtRestCryptoError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AtRestCryptoError";
    this.code = code;
  }
}

/**
 * Parse an operator-supplied key. Accepts 64 hex characters or standard
 * base64 of exactly 32 bytes. Never throws — `null` means "unusable", and a
 * caller decides whether that is a loud warning (boot) or a refusal (migrate).
 */
export function parseEncryptionKey(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  if (!B64.test(text)) return null;
  const buf = Buffer.from(text, "base64");
  // Buffer.from tolerates garbage; re-encoding proves the input was base64.
  if (buf.length !== KEY_SIZE || buf.toString("base64").replace(/=+$/, "") !== text.replace(/=+$/, "")) {
    return null;
  }
  return buf;
}

function isBase64Of(text, byteLength) {
  if (typeof text !== "string" || !text) return false;
  try {
    return Buffer.from(text, "base64").length === byteLength;
  } catch {
    return false;
  }
}

/** The envelope shape check. Cheap, structural, and independent of any key. */
export function isEnvelope(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value)
    && value.v === ENVELOPE_VERSION
    && isBase64Of(value.iv, IV_SIZE)
    && isBase64Of(value.tag, TAG_SIZE)
    && typeof value.data === "string"
    && isBase64Of(value.data, Buffer.from(value.data, "base64").length)
  );
}

function payloadToBuffer(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === "string") {
    if (payload.startsWith(PRE_ENCRYPTED_PREFIX)) {
      return Buffer.from(payload.slice(PRE_ENCRYPTED_PREFIX.length), "base64");
    }
    return Buffer.from(payload, "utf8");
  }
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export class AtRestCrypto {
  constructor(key) {
    this.key = key && key.length === KEY_SIZE ? Buffer.from(key) : null;
  }

  /** Never throws: an absent or malformed key yields a pass-through instance. */
  static fromEnv(env = process.env) {
    return new AtRestCrypto(parseEncryptionKey(env[AT_REST_KEY_ENV]));
  }

  static disabled() {
    return new AtRestCrypto(null);
  }

  get enabled() {
    return Boolean(this.key);
  }

  /** Returns the envelope object. Callers only reach here with a key. */
  seal(payload) {
    if (!this.enabled) throw new AtRestCryptoError("at-rest encryption is disabled", "AT_REST_DISABLED");
    const iv = randomBytes(IV_SIZE);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const body = Buffer.concat([cipher.update(payloadToBuffer(payload)), cipher.final()]);
    return {
      v: ENVELOPE_VERSION,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: body.toString("base64"),
    };
  }

  /**
   * Returns the plaintext string, or `null` when the envelope cannot be
   * opened (bad tag, wrong key, malformed members). Never throws: the caller
   * stays in charge of fail-open policy.
   */
  open(envelope) {
    if (!this.enabled) return null;
    try {
      const iv = Buffer.from(envelope.iv, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      const decipher = createDecipheriv(ALGO, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return null;
    }
  }
}

// ─── Object-level helpers — the single home every caller shares ──────────

/**
 * Seal one object field in place-safe form. Returns the envelope when the
 * field carries something (a non-empty string, an encrypted-Buffer triplet,
 * or a JSON-serialisable value) and a key exists; otherwise returns the value
 * unchanged. An ALREADY-sealed value is left alone, so sealing is idempotent.
 */
export function encryptField(crypto, value) {
  if (!crypto?.enabled || value === undefined || value === null) return value;
  if (typeof value === "string" && value === "") return value;
  if (isEnvelope(value)) return value;
  return crypto.seal(value);
}

/**
 * The fail-open read half. Three outcomes, in order:
 *   1. not an envelope                         → pass through untouched
 *   2. envelope, no key                        → pass through untouched
 *   3. envelope + key: opens → the plaintext; cannot open → audit + RAW
 * `onError(field, error)` is called for every failure; it must never throw
 * (the wrapper below swallows a throwing audit so the read still survives).
 * A JSON body that parses is returned as its value (arrays/objects restored),
 * a bare string body returns a string.
 */
export function decryptField(crypto, value, onError) {
  if (!isEnvelope(value)) return value;
  const fail = (reason) => {
    if (typeof onError === "function") {
      try { onError(reason); } catch { /* the trail must never break the read */ }
    }
    return value;
  };
  if (!crypto?.enabled) return value;
  const plain = crypto.open(value);
  if (plain === null) return fail(new AtRestCryptoError("envelope failed authentication", ERR_ENVELOPE_UNREADABLE));
  try {
    const parsed = JSON.parse(plain);
    return parsed;
  } catch {
    return plain;
  }
}

/** The field map every credential-bearing envelope covers. */
export function encryptFields(crypto, data, fields) {
  if (!crypto?.enabled || !data || typeof data !== "object") return data;
  let out = null;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const next = encryptField(crypto, data[field]);
    if (next === data[field]) continue;
    if (!out) out = { ...data };
    out[field] = next;
  }
  return out || data;
}

export function decryptFields(crypto, data, fields, onError) {
  if (!data || typeof data !== "object") return data;
  let out = null;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const next = decryptField(crypto, data[field], (error) => onError?.(field, error));
    if (next === data[field]) continue;
    if (!out) out = { ...data };
    out[field] = next;
  }
  return out || data;
}
