// CONNECTION VAULT — the row-shape half of envelope encryption.
//
// The crypto lives in src/lib/vault.js. This module knows which fields are
// credentials, how they are lifted out of `providerConnections.data`, and how
// they are put back on read. Both harbors (sqlite + mysql) call these helpers,
// so the slot law has exactly one home.
//
// THE SLOT LAW — ported from 9router-go's `internal/db/vault.go`:
//   secret  : apiKey, clientSecret
//   token   : accessToken, authToken, idToken
//   refresh : refreshToken
// Everything else — baseUrl, enabledModels, cooldown bookkeeping, provider
// metadata — stays plaintext on purpose. The model resolver walks connections
// on every listing and must never need the master key to do it.
//
// Nested credentials (providerSpecificData.idToken, clientSecret, …) ride the
// `secret` slot under a `nested.providerSpecificData.<name>` key, so a read
// re-injects them into the same object they came from.
import { getVault } from "../vault.js";
import { CONNECTION_NESTED_SECRET_FIELDS } from "./repos/backupSecurity.js";

export const SEALED_SLOTS = ["secret", "token", "refresh"];

export const SLOT_FIELDS = Object.freeze({
  secret: ["apiKey", "clientSecret"],
  token: ["accessToken", "authToken", "idToken"],
  refresh: ["refreshToken"],
});

/** slot → [wrappedDEK column, ciphertext column]. Literals, never derived, so
 *  a rename cannot silently retarget an UPDATE at the wrong pair. */
export const SLOT_COLUMNS = Object.freeze({
  secret: ["secretWrappedDEK", "secretCiphertext"],
  token: ["tokenWrappedDEK", "tokenCiphertext"],
  refresh: ["refreshWrappedDEK", "refreshCiphertext"],
});

export const SEALED_COLUMN_LIST = SEALED_SLOTS.flatMap((s) => SLOT_COLUMNS[s]);
export const SEALED_COLUMN_SQL = SEALED_COLUMN_LIST.join(", ");
const NESTED_PREFIX = "nested.providerSpecificData.";

function cloneObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : null;
}

/** True when this connection object carries any whitelisted plaintext secret. */
export function hasPlaintextCredential(conn) {
  if (!conn || typeof conn !== "object") return false;
  for (const slot of SEALED_SLOTS) {
    for (const field of SLOT_FIELDS[slot]) {
      if (typeof conn[field] === "string" && conn[field] !== "") return true;
    }
  }
  const psd = cloneObject(conn.providerSpecificData);
  if (psd) {
    for (const field of CONNECTION_NESTED_SECRET_FIELDS) {
      if (typeof psd[field] === "string" && psd[field] !== "") return true;
    }
  }
  return false;
}

/**
 * Lift credentials out of a connection object.
 *
 * Returns `{ conn, slots }`:
 *   conn  — the same connection with whitelisted secrets removed (safe to store)
 *   slots — { secret: {wrappedDEK, ciphertext}, … } for the slots that had a
 *           value; a slot absent from this map must NOT be written, so an
 *           update never erases a sealed pair it did not re-seal.
 *
 * `patch` (optional) is the incoming update body. A field explicitly set to
 * null/"" there clears its slot, so revoking a token cannot be undone by the
 * old ciphertext on the next read.
 */
export function sealConnection(conn, patch = null) {
  const vault = getVault();
  if (!vault.enabled) return { conn, slots: null };

  const out = { ...conn };
  const psd = cloneObject(out.providerSpecificData);
  const nested = {};
  const slots = {};

  for (const slot of SEALED_SLOTS) {
    const payload = {};
    let taken = false;
    for (const field of SLOT_FIELDS[slot]) {
      const value = out[field];
      if (typeof value === "string" && value !== "") {
        payload[field] = value;
        taken = true;
      }
      delete out[field];
    }

    if (slot === "secret" && psd) {
      for (const field of CONNECTION_NESTED_SECRET_FIELDS) {
        const value = psd[field];
        if (typeof value === "string" && value !== "") {
          nested[NESTED_PREFIX + field] = value;
          payload[NESTED_PREFIX + field] = value;
          delete psd[field];
          taken = true;
        }
      }
    }

    // With a patch, a slot is written ONLY when the patch touches it. The
    // merged object always carries hydrated credentials, so sealing every slot
    // on every update would re-encrypt untouched tokens and churn ciphertext
    // for a mere rename. `null` = clear, absent = leave the sealed pair alone.
    const touched = !patch
      || SLOT_FIELDS[slot].some((f) => Object.prototype.hasOwnProperty.call(patch, f))
      || (slot === "secret" && patch.providerSpecificData && typeof patch.providerSpecificData === "object"
          && CONNECTION_NESTED_SECRET_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(patch.providerSpecificData, f)));

    if (!touched) continue;
    if (taken) slots[slot] = vault.seal(JSON.stringify(payload));
    else slots[slot] = null;
  }

  if (psd) out.providerSpecificData = psd;
  return { conn: out, slots };
}

/** Re-inject every sealed slot that opens; failures leave the row untouched. */
export function openConnectionData(data, row, { onError } = {}) {
  const vault = getVault();
  if (!vault.enabled || !data || typeof data !== "object" || !row) return data;

  const fields = { ...data };
  let opened = false;

  for (const slot of SEALED_SLOTS) {
    const [wrappedCol, cipherCol] = SLOT_COLUMNS[slot];
    const wrapped = row[wrappedCol];
    const ciphertext = row[cipherCol];
    if (!wrapped || !ciphertext) continue;

    let plain;
    try {
      plain = vault.open(wrapped, ciphertext);
    } catch (e) {
      // One unreadable row must never take the other connections down, and the
      // ciphertext stays put for a later retry once the right key returns.
      if (typeof onError === "function") onError(slot, e);
      continue;
    }

    let payload;
    try { payload = JSON.parse(plain); } catch { continue; }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;

    for (const [key, value] of Object.entries(payload)) {
      if (key.startsWith(NESTED_PREFIX)) {
        const field = key.slice(NESTED_PREFIX.length);
        if (!fields.providerSpecificData || typeof fields.providerSpecificData !== "object") {
          fields.providerSpecificData = {};
        }
        fields.providerSpecificData[field] = value;
      } else {
        fields[key] = value;
      }
    }
    opened = true;
  }

  return opened ? fields : data;
}

/** Read the six sealed columns off a row, in slot order. */
export function sealedValuesFromRow(row) {
  return SEALED_SLOTS.flatMap((slot) => {
    const [w, c] = SLOT_COLUMNS[slot];
    return [row?.[w] ?? "", row?.[c] ?? ""];
  });
}
