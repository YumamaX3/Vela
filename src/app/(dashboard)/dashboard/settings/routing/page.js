"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import RoutingSection from "../components/RoutingSection";

export default function RoutingPage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    toggle: ctx.toggle,
    setString: ctx.setString,
    setNumber: ctx.setNumber,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Routing</h1>
        <p className="text-sm text-text-muted mt-1">
          Fallback strategy, combo rotation, sticky limits, and max retries —
          how Vela selects the next upstream when one fails.
        </p>
      </div>
      <RoutingSection {...sp} />
    </div>
  );
}