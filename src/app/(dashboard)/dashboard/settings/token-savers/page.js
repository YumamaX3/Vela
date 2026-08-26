"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import TokenSaverSection from "../components/TokenSaverSection";

export default function TokenSaversPage() {
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
        <h1 className="text-xl font-semibold">Token Savers</h1>
        <p className="text-sm text-text-muted mt-1">
          RTK pre-translate hooks — compress tool results before they leave the
          gateway. Caveman, Ponytail, PXPIPE, and Headroom.
        </p>
      </div>
      <TokenSaverSection {...sp} />
    </div>
  );
}