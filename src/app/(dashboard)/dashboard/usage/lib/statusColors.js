// Usage Observatory W2-C/W2-E — the status-class palette, one copy.
// The migration-008 taxonomy colors, shared by the Overview StatusMix donut
// and the Requests deck ledger pills / drawer / error anatomy views.
// gateway_error is proven a phantom (Gate 14) and is deliberately absent.
export const STATUS_COLORS = Object.freeze({
  ok: "#4ade80",
  client_error: "#f59e0b",
  upstream_error: "#ef4444",
  timeout: "#fb923c",
  rate_limited: "#a78bfa",
});

/** Human label for a statusClass — falls back to the raw value (the engine
 *  only ever returns the frozen taxonomy, so unknown = legacy raw status). */
export function statusClassLabel(statusClass) {
  const labels = {
    ok: "OK",
    client_error: "Client error",
    upstream_error: "Upstream error",
    timeout: "Timeout",
    rate_limited: "Rate limited",
  };
  return labels[statusClass] || statusClass || "—";
}
