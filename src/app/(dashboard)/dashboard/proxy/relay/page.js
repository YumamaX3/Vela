import RelayClient from "./RelayClient";

// The Relay lens on its own route — the old `?tab=relay`, now a URL (§4 · W3).
export default function ProxyRelayPage() {
  return <RelayClient />;
}
