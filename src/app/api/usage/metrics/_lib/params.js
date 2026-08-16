// Usage Observatory W2-B — shared machinery for the Metrics REST API.
//
// Sealed plan (W2-b) + phase13: every /api/usage/metrics/* route parses its
// query through here. The identifier covenant does the heavy lifting INSIDE
// the aggregation layer (frozen maps, FilterParamError on unknown), so this
// layer only does shape-shaping + one consistent error mapping — never
// validation-by-duplication.
//
// Needle-bar param names (phase7): ?tab&period&prov&model&key&status&q&gran
// The `prov`/`key` short forms map to the census keys provider/keyId.
import { NextResponse } from "next/server";
import { FilterParamError } from "@/lib/db/usageNames";

/** Parse the shared filter facet set out of the URL. Unknown facet values
 *  ride through untouched — the census builder treats them as equality
 *  parameters (never identifiers), so they cannot inject. */
export function parseFilters(searchParams) {
  const filters = {};
  const prov = searchParams.get("prov");
  const model = searchParams.get("model");
  const key = searchParams.get("key");
  const endpoint = searchParams.get("endpoint");
  const status = searchParams.get("status");
  const q = searchParams.get("q");
  if (prov) filters.provider = prov;
  if (model) filters.model = model;
  if (key) filters.keyId = key;
  if (endpoint) filters.endpoint = endpoint;
  if (status) filters.statusClass = status;
  if (q) filters.q = q;
  return filters;
}

/** period with a default — resolution + validity happen inside
 *  resolvePeriodWindow (FilterParamError on unknown), single source. */
export function parsePeriod(searchParams, fallback = "7d") {
  return searchParams.get("period") || fallback;
}

/** granularity — the impl validates against the frozen GRANULARITIES map. */
export function parseGranularity(searchParams, fallback = "1d") {
  return searchParams.get("gran") || fallback;
}

// ─── Coarse rate limit on metrics/* (phase13 DoS rail) ─────────────────────
// Deliberately coarse: a global sliding window over ALL metrics reads. The
// deployment is a local gateway — one noisy client should not starve the
// instrument. Exports carry their own stricter rails (concurrency lock +
// interval) in the export route.
const METRICS_WINDOW_MS = 10_000;
const METRICS_WINDOW_MAX = 120;
const metricsHits = [];

/** @returns true when the request may proceed. */
export function metricsThrottle() {
  const now = Date.now();
  while (metricsHits.length && metricsHits[0] <= now - METRICS_WINDOW_MS) metricsHits.shift();
  if (metricsHits.length >= METRICS_WINDOW_MAX) return false;
  metricsHits.push(now);
  return true;
}

/** The one error mapper for every metrics route: the identifier covenant's
 *  FilterParamError → 400 with the field named; anything else → 500, logged,
 *  never leaked. */
export function metricsErrorResponse(error, label) {
  if (error instanceof FilterParamError) {
    return NextResponse.json(
      { error: "INVALID_FILTER_PARAM", field: error.field, value: error.value },
      { status: 400 }
    );
  }
  console.error(`[API] usage/metrics/${label} failed:`, error);
  return NextResponse.json({ error: `Failed to fetch usage ${label}` }, { status: 500 });
}
