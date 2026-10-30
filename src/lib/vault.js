// ENVELOPE CREDENTIAL VAULT — the KEK/DEK layer beneath provider credentials.
//
// Ported from 9router-go `internal/vault` (F-5). The design, kept whole:
//
//   • A fresh random data-encryption key (DEK) encrypts each secret payload.
//   • The master key (KEK) encrypts the DEK.
//   • Rotating the master key therefore re-wraps only the small DEK columns;
//     no secret is decrypted and re-encrypted, and ciphertext stays identical.
//
// Wire format matches the Go implementation byte-for-byte: AES-256-GCM,
// standard base64, and a sealed blob laid out as `nonce || ciphertext || tag`.
// That is deliberate — a database sealed by either harbor can be opened by the
// other, which is the only honest meaning of "ported".
//
// LOSING THE KEY: if VELA_MASTER_KEY is gone and VELA_MASTER_KEY_PREVIOUS holds
// no usable retired key, every sealed credential is unrecoverable. That is
// inherent to envelope encryption without external escrow. Back the key up the
// same way as the database it protects.
//
// A missing or malformed key never refuses boot: the vault degrades to
// DISABLED (reads pass through, writes stay plaintext) with a loud warning,
// because taking a working install offline over an env var is the worse failure.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import * as log from "@/sse/utils/logger.js";

export const MASTER_KEY_ENV = "VELA_MASTER_KEY";
export const PREVIOUS_MASTER_KEY_ENV = "VELA_MASTER_KEY_PREVIOUS";
export const KEY_SIZE = 32;
const ALGO = "aes-256-gcm";
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

export class VaultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export const ERR_DISABLED = "VAULT_DISABLED";
export const ERR_TAMPERED = "VAULT_TAMPERED";
export const ERR_BAD_KEY = "VAULT_BAD_KEY";

function sealWith(key, plaintext) {
  const nonce = randomBytes(NONCE_SIZE);
  const cipher = createCipheriv(ALGO, key, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // Go's gcm.Seal appends the tag; Node keeps it separate. Concatenate in the
  // Go order so the two implementations can read each other's output.
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function openWith(key, sealed) {
  if (sealed.length < NONCE_SIZE + TAG_SIZE) {
    throw new VaultError("sealed payload is too short", ERR_TAMPERED);
  }
  const nonce = sealed.subarray(0, NONCE_SIZE);
  const tag = sealed.subarray(sealed.length - TAG_SIZE);
  const body = sealed.subarray(NONCE_SIZE, sealed.length - TAG_SIZE);
  try {
    const decipher = createDecipheriv(ALGO, key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new VaultError("sealed payload failed authentication", ERR_TAMPERED);
  }
}

function decodeBase64(value, label) {
  try {
    const buf = Buffer.from(String(value), "base64");
    // Buffer.from tolerates garbage; re-encoding proves the input was base64.
    if (!buf.length || buf.toString("base64").replace(/=+$/, "") !== String(value).replace(/=+$/, "")) {
      throw new Error("not base64");
    }
    return buf;
  } catch {
    throw new VaultError(`${label} is not valid base64`, ERR_TAMPERED);
  }
}

export class Vault {
  constructor(masterKey, previousKey = null) {
    this.current = masterKey ? Buffer.from(masterKey) : null;
    this.previous = previousKey ? Buffer.from(previousKey) : null;
  }

  static disabled() {
    return new Vault(null);
  }

  /** Never throws: an absent/blank/malformed key degrades to disabled. */
  static fromEnv(env = process.env) {
    const raw = String(env[MASTER_KEY_ENV] || "").trim();
    if (!raw) return Vault.disabled();

    let current;
    try {
      current = decodeMasterKey(raw);
    } catch (e) {
      log.warn("LIB", `[vault] ${MASTER_KEY_ENV} unusable (${e.message}); provider credentials stay in plaintext`);
      return Vault.disabled();
    }

    let previous = null;
    const prevRaw = String(env[PREVIOUS_MASTER_KEY_ENV] || "").trim();
    if (prevRaw) {
      try {
        previous = decodeMasterKey(prevRaw);
      } catch (e) {
        log.warn("LIB", `[vault] ${PREVIOUS_MASTER_KEY_ENV} unusable (${e.message}); rotations are not reversible`);
      }
    }
    return new Vault(current, previous);
  }

  get enabled() {
    return Boolean(this.current && this.current.length === KEY_SIZE);
  }

  /** Returns `{ wrappedDEK, ciphertext }`, both standard base64. */
  seal(plaintext) {
    if (!this.enabled) throw new VaultError("credential vault is disabled", ERR_DISABLED);
    const dek = randomBytes(KEY_SIZE);
    const sealed = sealWith(dek, Buffer.from(String(plaintext), "utf8"));
    const wrapped = sealWith(this.current, dek);
    return {
      wrappedDEK: wrapped.toString("base64"),
      ciphertext: sealed.toString("base64"),
    };
  }

  /** Reverses seal(). An empty wrappedDEK means the row was never sealed. */
  open(wrappedDEK, ciphertext) {
    if (!wrappedDEK) return ciphertext;
    if (!this.current && !this.previous) {
      throw new VaultError("credential vault is disabled", ERR_DISABLED);
    }
    const dek = this.unwrapDEK(wrappedDEK);
    const raw = decodeBase64(ciphertext, "ciphertext");
    return openWith(dek, raw).toString("utf8");
  }

  /** Installs a new master key, retiring the current one for later reads. */
  rotate(newMasterKey) {
    if (!this.enabled) throw new VaultError("credential vault is disabled", ERR_DISABLED);
    if (!newMasterKey || newMasterKey.length !== KEY_SIZE) {
      throw new VaultError(`master key must be ${KEY_SIZE} bytes`, ERR_BAD_KEY);
    }
    this.previous = this.current;
    this.current = Buffer.from(newMasterKey);
  }

  /** Re-wraps an existing DEK under a new master key; ciphertext untouched. */
  rewrap(wrappedDEK, newMasterKey) {
    if (!this.enabled) throw new VaultError("credential vault is disabled", ERR_DISABLED);
    if (!newMasterKey || newMasterKey.length !== KEY_SIZE) {
      throw new VaultError(`master key must be ${KEY_SIZE} bytes`, ERR_BAD_KEY);
    }
    const dek = this.unwrapDEK(wrappedDEK);
    return sealWith(newMasterKey, dek).toString("base64");
  }

  unwrapDEK(wrappedDEK) {
    const raw = decodeBase64(wrappedDEK, "wrapped DEK");
    if (this.current) {
      try { return openWith(this.current, raw); } catch { /* try the retired key */ }
    }
    if (this.previous && this.previous.length === KEY_SIZE) {
      try { return openWith(this.previous, raw); } catch { /* fall through */ }
    }
    throw new VaultError("wrapped DEK could not be opened by the current or previous key", ERR_TAMPERED);
  }
}

/** Decodes an operator-supplied base64 32-byte key (rotation endpoint). */
export function decodeMasterKey(encoded) {
  const raw = decodeBase64(String(encoded || "").trim(), "master key");
  if (raw.length !== KEY_SIZE) {
    throw new VaultError(`master key must decode to ${KEY_SIZE} bytes, got ${raw.length}`, ERR_BAD_KEY);
  }
  return raw;
}

let cached = null;
/** The process-wide vault. Env-derived once, so rotation is explicit. */
export function getVault() {
  if (!cached) cached = Vault.fromEnv();
  return cached;
}

/** Test seam — drop the cached vault after changing env. */
export function resetVault() {
  cached = null;
}
