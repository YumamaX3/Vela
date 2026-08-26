"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import NetworkSection from "../components/NetworkSection";

export default function NetworkPage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    patch: ctx.patch,
    toggle: ctx.toggle,
    setString: ctx.setString,
    setNumber: ctx.setNumber,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Network</h1>
        <p className="text-sm text-text-muted mt-1">
          Outbound proxy, request and connect timeouts, keep-alive pool, DNS
          prefetch, and pool geo probe.
        </p>
      </div>
      <NetworkSection {...sp} />
    </div>
  );
}