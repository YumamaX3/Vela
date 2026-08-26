"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import CapacityAdapterSection from "../components/CapacityAdapterSection";

export default function CapacityPage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    patchNested: ctx.patchNested,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Capacity Adapter</h1>
        <p className="text-sm text-text-muted mt-1">
          Route media-heavy requests — vision, PDF, audio input, and video input —
          through dedicated models instead of burning costly general-purpose tokens.
        </p>
      </div>
      <CapacityAdapterSection {...sp} />
    </div>
  );
}