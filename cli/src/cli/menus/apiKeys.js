const api = require("../api/client");
const { prompt, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { formatDate, getRelativeTime } = require("../utils/format");
const { showMenuWithBack } = require("../utils/menuHelper");
const { copyToClipboard } = require("../utils/clipboard");
const { getEndpoint } = require("../utils/endpoint");
const { storeKey, getKey, removeKey } = require("../utils/keyVault");

/**
 * Display API keys list with formatted output
 * @param {Array} keys - Array of API key objects
 * @param {number} port - Server port
 */
function displayApiKeys(keys, port) {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  🔑 API Keys Management                                 │");
  console.log("├─────────────────────────────────────────────────────────┤");
  // Note: This function is legacy, endpoint shown in menu header instead
  console.log("│                                                          │");
  
  if (keys.length === 0) {
    console.log("│  No API keys found.                                     │");
  } else {
    console.log(`│  Your API Keys (${keys.length}):${" ".repeat(42 - String(keys.length).length)}│`);
    
    keys.forEach((key, index) => {
      console.log("│                                                          │");
      console.log(`│  ${index + 1}. ${key.name}${" ".repeat(52 - String(index + 1).length - key.name.length)}│`);

      // Hash-at-rest: only the masked prefix is available after creation
      const maskedKey = key.keyPrefix || `vela-v1-${String(key.id).slice(0, 8)}…`;
      const onDevice = getKey(key.id) ? " · stored here" : "";
      const maskedLine = maskedKey + onDevice;
      console.log(`│     Key: ${maskedLine}${" ".repeat(Math.max(0, 47 - maskedLine.length))}│`);
      
      const created = formatDate(key.createdAt);
      console.log(`│     Created: ${created}${" ".repeat(43 - created.length)}│`);
      
      if (key.lastUsedAt) {
        const lastUsed = getRelativeTime(key.lastUsedAt);
        console.log(`│     Last used: ${lastUsed}${" ".repeat(41 - lastUsed.length)}│`);
      } else {
        console.log("│     Last used: Never                                    │");
      }
    });
  }
  
  console.log("│                                                          │");
  console.log("│  Actions:                                               │");
  console.log("│  1. Create New API Key                                  │");
  console.log("│  2. View Full Key (by number)                           │");
  console.log("│  3. Copy Key to Clipboard (by number)                   │");
  console.log("│  4. Delete Key (by number)                              │");
  console.log("│  0. ← Back to Main Menu                                 │");
  console.log("└─────────────────────────────────────────────────────────┘");
}

/**
 * Handle creating new API key
 * @returns {Promise<boolean>} Success status
 */
async function handleCreateKey() {
  console.log("\n📝 Create New API Key");
  console.log("─".repeat(30));
  
  const name = await prompt("Enter key name: ");
  
  if (!name) {
    showStatus("Key name cannot be empty", "error");
    await pause();
    return false;
  }
  
  const result = await api.createApiKey(name);

  if (!result.success) {
    showStatus(`Failed to create key: ${result.error}`, "error");
    await pause();
    return false;
  }

  // Capture-at-create (plan §3.6): the 201 carries the only plaintext copy.
  // Store it in the local CLI vault so setup paths can resolve it later.
  const record = result.data.record || {};
  const createdId = record.id || result.data.keyId;
  if (result.data.key && createdId) {
    storeKey(createdId, result.data.key);
  }

  console.log("\n✅ API Key created successfully!");
  console.log("\n⚠️  IMPORTANT: Save this key now. You won't be able to see it again!");
  console.log(`\nKey: ${result.data.key}`);
  console.log(`Name: ${record.name || ""}`);
  console.log(`ID: ${createdId || ""}`);
  
  const shouldCopy = await confirm("\nCopy key to clipboard?");
  if (shouldCopy) {
    if (copyToClipboard(result.data.key)) {
      showStatus("Key copied to clipboard!", "success");
    } else {
      showStatus("Failed to copy to clipboard", "error");
    }
  }
  
  await pause();
  return true;
}

/**
 * Handle viewing full API key
 * @param {Object} key - API key object
 */
async function handleViewFullKey(key) {
  console.log("\n🔍 Full API Key");
  console.log("─".repeat(30));
  console.log(`Name: ${key.name}`);
  // Hash-at-rest: the full key only exists if this device captured it at create time
  const full = getKey(key.id);
  if (full) {
    console.log(`Key: ${full}`);
  } else {
    console.log(`Key: ${key.keyPrefix || `vela-v1-${String(key.id).slice(0, 8)}…`} (full key not stored on this device)`);
  }
  console.log(`ID: ${key.id}`);
  console.log(`Created: ${formatDate(key.createdAt)}`);
  
  if (key.lastUsedAt) {
    console.log(`Last used: ${getRelativeTime(key.lastUsedAt)}`);
  } else {
    console.log("Last used: Never");
  }
  
  await pause();
}

/**
 * Handle copying API key to clipboard
 * @param {Object} key - API key object
 */
async function handleCopyKey(key) {
  const full = getKey(key.id);
  if (!full) {
    showStatus("Full key not stored on this device (keys are shown once, at creation)", "error");
    await pause();
    return;
  }
  if (copyToClipboard(full)) {
    showStatus(`Key "${key.name}" copied to clipboard!`, "success");
  } else {
    showStatus("Failed to copy to clipboard", "error");
  }
  await pause();
}

/**
 * Handle deleting API key
 * @param {Object} key - API key object
 * @returns {Promise<boolean>} Success status
 */
async function handleDeleteKey(key) {
  console.log(`\n⚠️  Delete API Key: ${key.name}`);
  console.log("─".repeat(30));
  console.log(`Key: ${key.keyPrefix || `vela-v1-${String(key.id).slice(0, 8)}…`}`);
  console.log(`Created: ${formatDate(key.createdAt)}`);

  const confirmed = await confirm("\nAre you sure you want to delete this key?");

  if (!confirmed) {
    showStatus("Deletion cancelled", "info");
    await pause();
    return false;
  }

  const result = await api.deleteApiKey(key.id);

  if (!result.success) {
    showStatus(`Failed to delete key: ${result.error}`, "error");
    await pause();
    return false;
  }

  // Purge the captured copy alongside the server-side revoke
  removeKey(key.id);

  showStatus("API key deleted successfully", "success");
  await pause();
  return true;
}

/**
 * Show actions for a specific key
 * @param {Object} key - API key object
 * @param {number} port - Server port
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showKeyActions(key, port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  await showMenuWithBack({
    title: `🔑 ${key.name}`,
    breadcrumb: [...breadcrumb, key.name],
    headerContent: `Name: ${key.name}\nKey: ${key.keyPrefix || `vela-v1-${String(key.id).slice(0, 8)}…`}\nEndpoint: ${endpoint}`,
    items: [
      {
        label: "Copy to Clipboard",
        action: async () => {
          await handleCopyKey(key);
          return true;
        }
      },
      {
        label: "Delete Key",
        action: async () => {
          await handleDeleteKey(key);
          return false; // Exit after delete
        }
      }
    ]
  });
}

/**
 * Main API Keys menu
 * @param {number} port - Server port number
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showApiKeysMenu(port, breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");
  
  const { endpoint } = await getEndpoint(port);
  await showListMenu({
    title: "🔑 API Keys Management",
    breadcrumb,
    headerContent: `Endpoint: ${endpoint}`,
    fetchItems: async () => {
      const result = await api.getApiKeys();
      if (!result.success) {
        clearScreen();
        showStatus(`Failed to fetch API keys: ${result.error}`, "error");
        await pause();
        return null;
      }
      return { items: result.data.keys || [] };
    },
    formatItem: (key) => `${key.name} (${key.keyPrefix || `vela-v1-${String(key.id).slice(0, 8)}…`})`,
    onSelect: async (key) => {
      await showKeyActions(key, port, breadcrumb);
    },
    createAction: {
      label: "Create New API Key",
      action: async () => {
        await handleCreateKey();
      }
    }
  });
}

module.exports = {
  showApiKeysMenu
};
