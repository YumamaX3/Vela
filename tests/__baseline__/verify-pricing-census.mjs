// Gate: pricing-covenant census must never shrink silently.
// Every count must be >= the snapshot; increases are allowed (rate research).
// Re-run snapshot-pricing-census.mjs after an INTENTIONAL shrink.
//   node tests/__baseline__/verify-pricing-census.mjs
import { readFileSync } from "node:fs";
import {
  MODEL_PRICING,
  PROVIDER_PRICING,
  PATTERN_PRICING,
  FREE_ALIAS_MAP,
  FREE_DENYLIST,
  UNPRICEABLE,
  PRICING_SOURCES,
} from "../../open-sse/providers/pricing.js";

const snapshot = JSON.parse(
  readFileSync(new URL("./pricing-census.json", import.meta.url), "utf8")
);

const laneModels = Object.values(PROVIDER_PRICING)
  .reduce((n, lane) => n + Object.keys(lane).length, 0);

const current = {
  modelPricing: Object.keys(MODEL_PRICING).length,
  providerLanes: Object.keys(PROVIDER_PRICING).length,
  laneModels,
  patternPricing: PATTERN_PRICING.length,
  freeAliasMap: Object.keys(FREE_ALIAS_MAP).length,
  freeDenylist: FREE_DENYLIST.size,
  unpriceable: UNPRICEABLE.length,
  pricingSources: Object.keys(PRICING_SOURCES).length,
};

const shrunk = [];
for (const [key, min] of Object.entries(snapshot)) {
  if (key === "captured") continue;
  if (current[key] < min) shrunk.push(`${key}: ${min} → ${current[key]}`);
}

if (shrunk.length) {
  console.error("❌ Pricing census shrank below baseline:\n  " + shrunk.join("\n  "));
  console.error("   Intentional? Re-snapshot: node tests/__baseline__/snapshot-pricing-census.mjs");
  process.exit(1);
}
console.log(`✅ Pricing census holds (${Object.keys(current).length} counts, none below baseline of ${snapshot.captured}).`);
