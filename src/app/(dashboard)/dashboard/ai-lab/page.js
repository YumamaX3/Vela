import { Suspense } from "react";
import AiLabClient from "./AiLabClient";

// Suspense boundary — the URL-facet hook reads useSearchParams, which traps
// the prerender without a boundary (the same P4 lesson as the Endpoint
// Observatory). The fallback is a skeleton so the deck never flashes empty.
export default function AiLabPage() {
  return (
    <Suspense fallback={<div className="h-24" />}>
      <AiLabClient />
    </Suspense>
  );
}
