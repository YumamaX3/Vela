import DiagnosticsClient from "./DiagnosticsClient";

// The Diagnostics shore — the old `?tab=diagnostics`, now a URL (§3.1 · W3).
export default function DiagnosticsPage() {
  return <DiagnosticsClient />;
}
