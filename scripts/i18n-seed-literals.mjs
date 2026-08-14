#!/usr/bin/env node
// i18n literal seeder — plans/vela-key-governance.md §3.7.
// Seeds NEW dashboard strings into every public/i18n/literals/*.json file.
// English-first (W1): missing keys are inserted with the English string as a
// placeholder value; real translations are backfilled separately. The runtime
// (src/i18n/runtime.js) falls back to the English input when a key is absent,
// so seeding placeholders is behavior-neutral — it makes coverage trackable.
//
// Usage: node scripts/i18n-seed-literals.mjs          (seed + report)
//        node scripts/i18n-seed-literals.mjs --check   (exit 1 if any key missing)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LITERALS_DIR = path.resolve(__dirname, "../public/i18n/literals");

// Strings introduced by the API-key governance UI (/dashboard/endpoint).
// The parity test (tests/unit/i18n-literals-parity.test.js) imports this list
// and asserts every locale file carries every one of these keys.
export const GOVERNANCE_STRINGS = [
  "API Keys",
  "Create Key",
  "Require API key",
  "Requests without a valid key will be rejected",
  "No API keys yet",
  "Create your first API key to get started",
  "Create API Key",
  "Key Name",
  "Description (optional)",
  "What this key is used for",
  "Restrict models",
  "Limit which models this key can call",
  "No models available",
  "Add Model",
  "Remove",
  "No models selected",
  "Select models",
  "selected",
  "Create",
  "Cancel",
  "API Key Created",
  "Save this key now!",
  "This is the only time this key will ever be shown. Vela stores only its hash — if you lose it, create a new key and delete this one.",
  "Copy",
  "Copied!",
  "I have saved this key in a secure location",
  "Done",
  "Edit API Key",
  "Save",
  "Saving...",
  "Delete API Key",
  "Pause API Key",
  "Paused",
  "Active",
  "All models",
  "stored here",
  "Production Key",
  "Edit name, description, allowed models",
  "Copy full key (from this browser's vault)",
  "Forget the full key from this browser's vault",
  "Delete (revoke)",
  "Pause key",
  "Resume key",
  // W3 limits editor (KeyLimitsEditor + endpoint page badges)
  "Limits",
  "Rate limit",
  "Requests per minute",
  "Unlimited",
  "Custom",
  "Token budget",
  "Tokens allowed per window",
  "Spend cap",
  "Maximum spend per window",
  "Reset window",
  "Budget window applies to both token budget and spend cap",
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "Expiration",
  "Never",
  "In 7 days",
  "In 30 days",
  "In 90 days",
  "Custom date",
  "IP allowlist",
  "Only these addresses may use this key",
  "One CIDR per line (e.g. 10.0.0.0/8). Empty = unrestricted.",
  "Key limit",
];

export function listLocaleFiles() {
  return fs
    .readdirSync(LITERALS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

const checkOnly = process.argv.includes("--check");
let drift = 0;
let added = 0;

for (const file of listLocaleFiles()) {
  const full = path.join(LITERALS_DIR, file);
  const map = JSON.parse(fs.readFileSync(full, "utf8"));
  let changed = false;
  for (const str of GOVERNANCE_STRINGS) {
    if (!(str in map)) {
      drift++;
      if (!checkOnly) {
        map[str] = str; // English-first placeholder until translated
        changed = true;
        added++;
      }
    }
  }
  if (changed) fs.writeFileSync(full, JSON.stringify(map, null, 2) + "\n");
}

if (checkOnly) {
  if (drift) {
    console.error(`❌ i18n drift: ${drift} governance key(s) missing across locale files.`);
    console.error("   Run: node scripts/i18n-seed-literals.mjs");
    process.exit(1);
  }
  console.log(`✅ i18n parity: all ${GOVERNANCE_STRINGS.length} governance keys present in every locale file`);
} else {
  console.log(`✅ i18n seed: ${added} key(s) added across locale files (${drift} were missing)`);
}
