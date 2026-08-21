// Usage Observatory W2-B — useCompassFilters (sealed plan W2(b)).
//
// The Needle bar's single source of truth is the URL: every facet reads from
// and writes to search params via router.replace({scroll:false}) —
// bookmarkable, no history spam, and tab switches NEVER clear filters (the
// dormant-facet round-trip: a facet a deck doesn't render still rides the
// URL and returns when its deck is active again).
//
// FACETS constancy (phase7): the shared facets (period, provider, model,
// key) render in the SAME order/position on every deck. Deck-adaptive facets
// (status, q, gran, deck-local extras) append after them.
"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/** Shared-facet constancy map — order is law across every deck.
 *  `param` is the URL key (phase7: prov/model/key short forms). */
export const FACETS = Object.freeze({
  period: Object.freeze({ param: "period", order: 0, shared: true }),
  provider: Object.freeze({ param: "prov", order: 1, shared: true }),
  model: Object.freeze({ param: "model", order: 2, shared: true }),
  key: Object.freeze({ param: "key", order: 3, shared: true }),
  status: Object.freeze({ param: "status", order: 4, shared: false }),
  q: Object.freeze({ param: "q", order: 5, shared: false }),
  gran: Object.freeze({ param: "gran", order: 6, shared: false }),
});

export const DECKS = ["overview", "analytics", "requests", "quota", "providers", "logs"];

/** Auto-granularity derived from period (sealed plan W2-b):
 *  today/24h → 1h · 7d/30d/60d/all → 1d. An explicit `gran` param overrides. */
const AUTO_GRANULARITY = Object.freeze({
  today: "1h",
  "24h": "1h",
  "7d": "1d",
  "30d": "1d",
  "60d": "1d",
  all: "1d",
});

export function useCompassFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tab = DECKS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const period = searchParams.get("period") || "today";
  const provider = searchParams.get("prov") || "";
  const model = searchParams.get("model") || "";
  const key = searchParams.get("key") || "";
  const status = searchParams.get("status") || "";
  const q = searchParams.get("q") || "";
  const granParam = searchParams.get("gran") || "";
  const granularity = granParam || AUTO_GRANULARITY[period] || "1d";

  /** Set one facet. Empty/null clears it. Dormant facets round-trip: every
   *  other param is preserved verbatim — nothing is ever dropped. */
  const setFacet = useCallback((name, value) => {
    const params = new URLSearchParams(searchParams.toString());
    const facet = FACETS[name];
    const paramKey = facet ? facet.param : name; // deck-local extras allowed
    if (value === null || value === undefined || value === "") params.delete(paramKey);
    else params.set(paramKey, String(value));
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  /** Set several facets in ONE URL write (W2-E): two sequential setFacet
   *  calls in the same handler both read the pre-update searchParams, so the
   *  second would clobber the first — sort+order must move atomically. */
  const setFacets = useCallback((entries) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [name, value] of Object.entries(entries)) {
      const facet = FACETS[name];
      const paramKey = facet ? facet.param : name;
      if (value === null || value === undefined || value === "") params.delete(paramKey);
      else params.set(paramKey, String(value));
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const setTab = useCallback((next) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  /** Clear every filter facet (period included — it is a facet too); the tab
   *  survives. Builds a fresh param set, so searchParams is not needed. */
  const clearFilters = useCallback(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, tab]);

  /** Census-shaped filters for the metrics API — mirrors the Needle param
   *  names the REST layer parses (prov→provider, key→keyId, status→statusClass). */
  const filters = useMemo(() => {
    const f = {};
    if (provider) f.provider = provider;
    if (model) f.model = model;
    if (key) f.keyId = key;
    if (status) f.statusClass = status;
    if (q) f.q = q;
    return f;
  }, [provider, model, key, status, q]);

  /** Query string for metrics fetches — period + facets + granularity, only
   *  non-empty values. Decks fetch `/api/usage/metrics/*?${metricsQuery}`. */
  const metricsQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("period", period);
    if (provider) params.set("prov", provider);
    if (model) params.set("model", model);
    if (key) params.set("key", key);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (granParam) params.set("gran", granParam);
    return params.toString();
  }, [period, provider, model, key, status, q, granParam]);

  const hasActiveFilters = Boolean(provider || model || key || status || q);

  // W2-E — Requests deck sort state (deck-local, URL-riding like every facet).
  // The engine's identifier covenant validates the column server-side; the
  // client mirror (usageEnrich.js) keeps the header from offering invalids.
  const sort = searchParams.get("sort") || "timestamp";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const setSort = useCallback((column) => {
    const nextOrder = sort === column && order === "desc" ? "asc" : "desc";
    setFacets({ sort: column, order: nextOrder });
  }, [sort, order, setFacets]);

  return {
    tab, setTab,
    period, provider, model, key, status, q,
    granParam, granularity,
    sort, order, setSort,
    filters, metricsQuery, hasActiveFilters,
    setFacet, setFacets, clearFilters,
  };
}

export default useCompassFilters;
