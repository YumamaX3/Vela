import { Suspense } from "react";
import EndpointPageClient from "./EndpointPageClient";

// Suspense boundary — the URL-facet hook (useEndpointFacets) reads
// useSearchParams, which traps the prerender without a boundary (P4 of the
// sealed plan). The fallback is a skeleton card so the tab shell never
// flashes empty on first paint.
export default function EndpointPage() {
  return (
    <Suspense fallback={<div className="h-24" />}>
      <EndpointPageClient />
    </Suspense>
  );
}
