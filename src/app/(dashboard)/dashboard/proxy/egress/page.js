import EgressClient from "./EgressClient";

// The Egress lens on its own route — the old `?tab=egress`, now a URL (§4 · W3).
export default function ProxyEgressPage() {
  return <EgressClient />;
}
