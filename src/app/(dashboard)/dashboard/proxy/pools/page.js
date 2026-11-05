import PoolsClient from "./PoolsClient";

// The Fleet lens on its own route — the old `?tab=fleet`, now a URL (§4 · W3).
export default function ProxyPoolsPage() {
  return <PoolsClient />;
}
