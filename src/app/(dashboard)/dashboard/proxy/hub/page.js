import HubClient from "./HubClient";

// The Proxy hub on its own route. `/dashboard/proxy` redirects here (§4 · W3), so the
// hub has one canonical address and every link to "the proxy console" resolves to it.
export default function ProxyHubPage() {
  return <HubClient />;
}
