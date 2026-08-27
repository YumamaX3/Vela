// useEndpointFacets — the ONE shared URL-facet hook (Endpoint Observatory
// W1d, Covenant P5: shared hooks, no clone-forget copies).
//
// The Keys tab, Audit tab, Overview and CommandPalette ALL consume this
// hook — a facet registry + router.replace spine that is idempotent and
// validated (see src/lib/endpoint/facetRegistry.js for the trust boundary).
//
// Requires the consuming component to sit inside a <Suspense> boundary
// (P4 — useSearchParams prerender trap).
"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { parseParams, buildParams, mergeFacets } from "@/lib/endpoint/facetRegistry.js";

export function useEndpointFacets() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const parsed = useMemo(() => parseParams(searchParams), [searchParams]);
  const state = parsed.state;
  const rejected = parsed.rejected;

  /** Replace the URL with the new facet state — scroll:false (P4 behavior). */
  const setFacets = useCallback(
    (patch) => {
      const next = mergeFacets(state, patch);
      const qs = buildParams(next);
      const href = qs ? `${pathname}?${qs}` : pathname;
      router.replace(href, { scroll: false });
    },
    [router, pathname, state]
  );

  /** Reset all facets to defaults. */
  const resetFacets = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return { state, rejected, setFacets, resetFacets };
}
