// Usage Observatory W2-C — useProviders: connected-provider list for the
// Overview deck's topology (Row B). Extracted from UsageStats.js' fetch
// pattern so the deck owns its own provider picture without importing the
// orchestrator. Deduplicates by provider type, keeps custom-node names, and
// always includes noAuth free providers (they serve traffic without a
// connection row).
"use client";

import { useState, useEffect } from "react";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

export function useProviders() {
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, nodesData]) => {
        if (!alive) return;
        const nodeNameMap = {};
        for (const node of nodesData?.nodes || []) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set();
        const unique = (d?.connections || [])
          .filter((c) => {
            if (c.isActive === false) return false;
            if (!isLLMProvider(c.provider)) return false;
            if (seen.has(c.provider)) return false;
            seen.add(c.provider);
            return true;
          })
          .map((c) => ({ ...c, nodeName: nodeNameMap[c.provider] || null }));

        const noAuthProviders = [...Object.values(FREE_PROVIDERS), ...Object.values(FREE_TIER_PROVIDERS)]
          .filter((p) => p.noAuth && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return providers;
}

export default useProviders;
