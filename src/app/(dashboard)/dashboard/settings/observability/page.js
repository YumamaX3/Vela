"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import ObservabilitySection from "../components/ObservabilitySection";

export default function ObservabilityPage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    toggle: ctx.toggle,
    setNumber: ctx.setNumber,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Observability</h1>
        <p className="text-sm text-text-muted mt-1">
          Request/response telemetry ring buffer — max records, batch size,
          flush interval, and max JSON payload size.
        </p>
      </div>
      <ObservabilitySection {...sp} />
    </div>
  );
}