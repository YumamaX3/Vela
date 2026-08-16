// Usage Observatory W2-B — status-class options, one copy.
// Mirrors src/lib/usageStatus.js STATUS_CLASSES (the migration-008 taxonomy:
// gateway_error was proven a phantom and is deliberately absent — Gate 14).
export const statusClassOptions = [
  { value: "ok", label: "OK" },
  { value: "client_error", label: "Client error" },
  { value: "upstream_error", label: "Upstream error" },
  { value: "timeout", label: "Timeout" },
  { value: "rate_limited", label: "Rate limited" },
];
