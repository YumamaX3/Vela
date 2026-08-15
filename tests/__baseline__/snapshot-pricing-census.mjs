// Snapshot the pricing-covenant census — counts of the rate tables, derived
// from open-sse/providers/pricing.js (never hardcoded). Run after intentional
// rate-table changes; verify-pricing-census.mjs guards against silent shrinkage.
//   node tests/__baseline__/snapshot-pricing-census.mjs
import { writeFileSync } from "node:fs";
import {
  MODEL_PRICING,
  PROVIDER_PRICING,
  PATTERN_PRICING,
  FREE_ALIAS_MAP,
  FREE_DENYLIST,
  UNPRICEABLE,
  PRICING_SOURCES,
} from "../../open-sse/providers/pricing.js";

const laneModels = Object.values(PROVIDER_PRICING)
  .reduce((n, lane) => n + Object.keys(lane).length, 0);

const census = {
  captured: new Date().toISOString().slice(0, 10),
  modelPricing: Object.keys(MODEL_PRICING).length,
  providerLanes: Object.keys(PROVIDER_PRICING).length,
  laneModels,
  patternPricing: PATTERN_PRICING.length,
  freeAliasMap: Object.keys(FREE_ALIAS_MAP).length,
  freeDenylist: FREE_DENYLIST.size,
  unpriceable: UNPRICEABLE.length,
  pricingSources: Object.keys(PRICING_SOURCES).length,
};

writeFileSync(
  new URL("./pricing-census.json", import.meta.url),
  JSON.stringify(census, null, 2) + "\n"
);
console.log("✅ pricing census snapshot:", JSON.stringify(census));
