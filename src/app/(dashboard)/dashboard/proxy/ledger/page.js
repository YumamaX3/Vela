import LedgerClient from "./LedgerClient";

// The Ledger lens on its own route — the routing trace, §4 · W4 (§1: "Routing
// ledger — recent route decisions, health score").
export default function ProxyLedgerPage() {
  return <LedgerClient />;
}
