// Client-side key vault — the capture-at-create keystore (plan §3.6).
// Browser-only (localStorage). Hash-at-rest means the server can never hand the
// full key back after the 201 creation response, so the dashboard captures the
// one-time full key into localStorage keyed by keyId. Tool cards read from here
// when they must write a bearer token into a CLI tool config. This is the
// sanctioned show-once escape hatch for the dashboard UX — never synced, never
// sent to the server, clearable per-key or in bulk.
const NS = "vela.keyVault.v1";

function readVault() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(NS) : null;
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeVault(vault) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(NS, JSON.stringify(vault));
  } catch {}
}

/** Store a one-time full key under its keyId. Returns the key for chaining. */
export function storeKey(keyId, fullKey) {
  if (!keyId || !fullKey) return fullKey;
  const vault = readVault();
  vault[keyId] = fullKey;
  writeVault(vault);
  return fullKey;
}

/** Read the full key for a keyId, or null if not captured on this device. */
export function getKey(keyId) {
  if (!keyId) return null;
  return readVault()[keyId] || null;
}

/** Does this device hold the full key for a keyId? */
export function hasKey(keyId) {
  return !!getKey(keyId);
}

/** Remove a single keyId from the vault (call on key revoke/delete). */
export function removeKey(keyId) {
  if (!keyId) return;
  const vault = readVault();
  if (!(keyId in vault)) return;
  delete vault[keyId];
  writeVault(vault);
}

/** Clear every captured key. */
export function clearVault() {
  writeVault({});
}

/**
 * Extract keyId from a full vela key, loose (no CRC — the key came from our own
 * vault/201, identity match only). Mirrors server-side extractKeyIdLoose.
 */
export function parseKeyId(fullKey) {
  if (typeof fullKey !== "string" || !fullKey.startsWith("vela-")) return null;
  const parts = fullKey.slice("vela-".length).split("-");
  if (parts.length !== 3) return null;
  return /^[0-9a-f]{32}$/.test(parts[1]) ? parts[1] : null;
}

/**
 * Resolve a key reference to a usable full key for CLI-config writes.
 * - A full vela key (custom input) passes through unchanged.
 * - A bare keyId is looked up in the local vault.
 * - Anything else (empty, legacy sk-, unknown) → null so the caller can decide.
 * This is the bridge between masked list rows and the full keys CLI tools need.
 */
export function resolveKeyRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("vela-")) {
    // Looks like a full key — use it directly (custom-entered).
    return trimmed;
  }
  // Treat as a keyId — look up the captured full key.
  return getKey(trimmed);
}
