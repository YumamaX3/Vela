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
  // Harbor homepage (/dashboard)
  "Good morning",
  "Good afternoon",
  "Good evening",
  "Your gateway, at a glance",
  "active",
  "Idle",
  "Gateway endpoint",
  "Point your AI tools at this OpenAI-compatible endpoint — Vela routes, translates, and governs every request.",
  "Requests today",
  "Tokens today",
  "Spend today",
  "Cache rate",
  "Activity",
  "Requests in the last 10 minutes",
  "Top models today",
  "No traffic yet — send a request to see it here.",
  "Harbor status",
  "Governance and exposure",
  "API key required",
  "Dashboard login",
  "Cloud sync",
  "Tunnel",
  "Manage API keys",
  "Quick nav",
  "Combos",
  "Quota",
  "CLI Tools",
  "On",
  "Off",
  "No requests in the last 10 minutes",
  // Sidebar upgrade (Vela brand + grouped navigation)
  "AI Gateway",
  "New version available",
  "Update now",
  "Home",
  "Gateway",
  "Analytics",
  "Tools",
  "System",
  "Media Providers",
  "Server Disconnected",
  "The gateway has been stopped.",
  "Reload Page",
];

// Usage Observatory — the Compass Deck cockpit (W2-B). Hard cap ≤40 new
// literals (Tidebreaker S4); the four anchor question-strings seed all
// locales, and later waves (W2-C..W2-G) compose ChartPanel/panel copy from
// this shared set rather than adding bespoke strings.
export const USAGE_OBSERVATORY_STRINGS = [
  "Usage Observatory",
  "live",
  "Export CSV",
  "Overview",
  "Analytics",
  "Requests",
  "Accounts & Limits",
  "Where did the money go?",
  "Is it healthy?",
  "What happened?",
  "What are my limits?",
  "All providers",
  "All models",
  "All keys",
  "All statuses",
  "Search model, provider, endpoint…",
  "Auto",
  "1h",
  "6h",
  "1d",
  "Clear filters",
  "OK",
  "Client error",
  "Upstream error",
  "Timeout",
  "Rate limited",
  "As of",
  "estimated",
  "dedupe may undercount",
  "Cost and savings are estimates computed from pricing at write time",
  "Duplicate provider/model rows may undercount totals slightly",
  "Health panels arrive with the next tide",
  "Latency, error mix, cache share and savings — collecting since the telemetry upgrade.",
  // W2-C Overview deck rows (budget: 33 → 40, the hard cap). KPI metric labels
  // form the ONE shared set W2-D Analytics reuses; Row E + Status mix own their
  // titles. Row C/D chart titles compose from these metric labels, never bespoke.
  "Est. Cost",
  "Input Tokens",
  "Output Tokens",
  "Cached Tokens",
  "RTK Savings",
  "Top Spenders",
  "Status mix",
];

// W3-C alert channels — cockpit banner + the Limits-deck config card.
export const W3C_ALERT_STRINGS = [
  "Budget alerts",
  "and {n} more",
  "Alert channels",
  "Budget alerts fire at 50%, 80%, and 100% of each budget window.",
  "Discord webhook",
  "Send budget alerts to a Discord channel.",
  "Discord webhook URL",
  "n8n webhook",
  "Send budget alerts to an n8n workflow.",
  "n8n webhook URL",
  "Saved",
  "Save failed",
  "Saving…",
  "Stored — replace to change",
  "Webhook URLs are stored masked — never echoed back.",
];

export function listLocaleFiles() {
  return fs
    .readdirSync(LITERALS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

// W3-D weekly digest — the Limits-deck toggle copy.
export const W3D_DIGEST_STRINGS = [
  "Weekly digest",
  "Send a summary of last week's usage to the channels above every Monday.",
];

// W3-E compare-periods — the CostArea ghost overlay.
export const W3E_COMPARE_STRINGS = [
  "Compare",
  "Compare with previous period",
  "previous period",
];

// W4-A saved views — the Needle bar's Views menu.
export const W4A_SAVED_VIEWS_STRINGS = [
  "Saved views",
  "Views",
  "No saved views yet",
  "Saved views keep your compass settings one click away.",
  "Save current view",
  "View name",
  "View name is required",
  "Failed to save view",
  "A view named \"{name}\" already exists — saving replaces it.",
  "Replace",
  "Delete view",
];

// W4-B auto-insights — the Lookout signal registry. Templates carry the
// registry's attribution params; the signal kinds themselves are stable
// registry keys (never rendered raw).
export const W4B_INSIGHT_STRINGS = [
  "Insights",
  "Nothing unusual in this window",
  "{pct}% of requests in this window failed — error rate is elevated",
  "Most failures are {statusClass} ({pct}% of errors)",
  "{provider} accounts for {pct}% of spend in this window",
  "Spend is {times}× the previous period",
  "p95 latency is {secs}s in this window",
];

// W4-C request tags — the ledger drawer's annotation surface.
export const W4C_TAG_STRINGS = [
  "Tags",
  "No tags yet",
  "Add tag…",
  "Add",
  "Saving",
  "Could not save tags",
  "Remove tag {tag}",
];

// Every wave's literal group seeds the same locale files, English-first.
export const ALL_LITERAL_GROUPS = [GOVERNANCE_STRINGS, USAGE_OBSERVATORY_STRINGS, W3C_ALERT_STRINGS, W3D_DIGEST_STRINGS, W3E_COMPARE_STRINGS, W4A_SAVED_VIEWS_STRINGS, W4B_INSIGHT_STRINGS, W4C_TAG_STRINGS];

const checkOnly = process.argv.includes("--check");
let drift = 0;
let added = 0;

for (const file of listLocaleFiles()) {
  const full = path.join(LITERALS_DIR, file);
  const map = JSON.parse(fs.readFileSync(full, "utf8"));
  let changed = false;
  for (const group of ALL_LITERAL_GROUPS) {
    for (const str of group) {
      if (!(str in map)) {
        drift++;
        if (!checkOnly) {
          map[str] = str; // English-first placeholder until translated
          changed = true;
          added++;
        }
      }
    }
  }
  if (changed) fs.writeFileSync(full, JSON.stringify(map, null, 2) + "\n");
}

const totalKeys = ALL_LITERAL_GROUPS.reduce((n, g) => n + g.length, 0);

if (checkOnly) {
  if (drift) {
    console.error(`❌ i18n drift: ${drift} key(s) missing across locale files.`);
    console.error("   Run: node scripts/i18n-seed-literals.mjs");
    process.exit(1);
  }
  console.log(`✅ i18n parity: all ${totalKeys} literal keys present in every locale file`);
} else {
  console.log(`✅ i18n seed: ${added} key(s) added across locale files (${drift} were missing)`);
}
