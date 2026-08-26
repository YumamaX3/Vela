"use client";

import { useEffect } from "react";
import { Card } from "@/shared/components";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";
import SettingsSection from "./SettingsSection";

const ACCENT_HEX = {
  coral: "#E56A4A",
  ocean: "#3B82F6",
  emerald: "#10B981",
  violet: "#8B5CF6",
  amber: "#F59E0B",
};

export default function AppearanceSection({ settings, loading, toggle, setString }) {
  const { theme, setTheme } = useTheme();

  // The chosen accent overrides --color-brand-500 (and --color-primary via it)
  // so every consumer of the brand token follows the pick — real, not placebo.
  useEffect(() => {
    if (!settings?.accentColor) return;
    const hex = ACCENT_HEX[settings.accentColor];
    if (!hex) return;
    document.documentElement.style.setProperty("--color-brand-500", hex);
    return () => document.documentElement.style.removeProperty("--color-brand-500");
  }, [settings?.accentColor]);

  if (!settings) return null;

  return (
    <>
      {/* Theme selector */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-green-500/10 text-green-500 shrink-0">
            <span className="material-symbols-outlined text-[20px]">palette</span>
          </div>
          <h3 className="text-base sm:text-lg font-semibold">Theme</h3>
        </div>
        <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5 w-full sm:w-auto">
          {["light", "dark", "system"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTheme(option)}
              className={cn(
                "flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md font-medium transition-all flex-1 sm:flex-initial",
                theme === option
                  ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[18px]">
                {option === "light" ? "light_mode" : option === "dark" ? "dark_mode" : "contrast"}
              </span>
              <span className="capitalize text-xs sm:text-sm">{option}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Appearance */}
      <SettingsSection icon="style" title="Appearance" accent="green">
        <div className="flex flex-col gap-4">
          {/* Accent color — the single live appearance control; it overrides the
              brand token app-wide via the effect above. */}
          <div className="flex flex-col gap-2">
            <label className="font-medium text-sm">Accent Color</label>
            <div className="flex flex-wrap gap-2">
              {["coral", "ocean", "emerald", "violet", "amber"].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setString("accentColor", color)}
                  disabled={loading}
                  className={cn(
                    "w-9 h-9 rounded-full border-2 transition-all",
                    (settings.accentColor || "coral") === color
                      ? "border-text-main scale-110 shadow-md"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ background: ACCENT_HEX[color] }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}