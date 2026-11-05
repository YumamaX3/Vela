import UsageClient from "./UsageClient";

// The Usage lens on its own route — the per-pool usage census, §4 · W4 (§1:
// "Per-pool usage analytics — requests, tokens, latency").
export default function ProxyUsagePage() {
  return <UsageClient />;
}
