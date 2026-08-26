"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import AppearanceSection from "../components/AppearanceSection";
import LanguageSection from "../components/LanguageSection";

export default function AppearancePage() {
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
        <h1 className="text-xl font-semibold">Appearance</h1>
        <p className="text-sm text-text-muted mt-1">
          Theme, accent color, and language preferences.
        </p>
      </div>
      <AppearanceSection {...sp} />
      <LanguageSection {...sp} />
    </div>
  );
}