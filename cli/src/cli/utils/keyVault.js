// CLI key vault — capture-at-create keystore (plan §3.6).
// Under hash-at-rest the server can never hand the full key back after the 201
// creation response. So the CLI captures the one-time full key at create time and
// persists it locally, keyed by keyId. Quick-setup paths read from here instead of
// the masked GET /api/keys list. Never sent to the server; clearable per-key.
const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "vela";
const VAULT_FILE_NAME = "cli-keyvault.json";

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const os = require("node:os");
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function vaultPath() {
  return path.join(getDataDir(), VAULT_FILE_NAME);
}

function readVault() {
  try {
    const raw = fs.readFileSync(vaultPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeVault(vault) {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(vaultPath(), JSON.stringify(vault, null, 2), { mode: 0o600 });
  } catch {
    // best effort — a non-writable dir should not break the CLI
  }
}

function storeKey(keyId, fullKey) {
  if (!keyId || !fullKey) return;
  const vault = readVault();
  vault[keyId] = fullKey;
  writeVault(vault);
}

function getKey(keyId) {
  if (!keyId) return null;
  return readVault()[keyId] || null;
}

function hasKey(keyId) {
  return !!getKey(keyId);
}

function removeKey(keyId) {
  if (!keyId) return;
  const vault = readVault();
  if (!(keyId in vault)) return;
  delete vault[keyId];
  writeVault(vault);
}

/** Loose keyId extraction (no CRC) — identity match for keys we minted/read. */
function parseKeyId(fullKey) {
  if (typeof fullKey !== "string" || !fullKey.startsWith("vela-")) return null;
  const parts = fullKey.slice("vela-".length).split("-");
  if (parts.length !== 3) return null;
  return /^[0-9a-f]{32}$/.test(parts[1]) ? parts[1] : null;
}

/** Resolve a key reference: full vela key passes through; keyId looks up the vault. */
function resolveKeyRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("vela-")) return trimmed;
  return getKey(trimmed);
}

module.exports = { storeKey, getKey, hasKey, removeKey, parseKeyId, resolveKeyRef, vaultPath };
