"use client";

import { useEffect, useState } from "react";
import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle } from "@/shared/components";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";

export default function LanguageSection({ settings, loading, toggle }) {
  // Hooks must be declared unconditionally — the early return below is a
  // runtime guard, not a hook boundary. (react-hooks/rules-of-hooks)
  const [locale, setLocale] = useState("en");
  const router = useRouter();

  useEffect(() => {
    // SSR-safe — document only exists client-side after mount
    if (typeof document === "undefined") return;
    const cookie = document.cookie
      .split(";")
      .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
    const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
    setLocale(normalizeLocale(value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!settings) return null;

  const switchLocale = (code) => {
    const normalized = normalizeLocale(code);
    const isDefault = normalized === "en";
    const expiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(normalized)}; path=/; expires=${expiry}${isDefault ? "" : "; SameSite=Lax"}`;
    setLocale(normalized);
    router.refresh();
  };

  return (
    <SettingsSection icon="language" title="Language" accent="purple">
      <div className="flex flex-col gap-4">
        <SettingsRow label="Auto-detect Locale" desc="Use browser language automatically">
          <Toggle checked={settings.autoDetectLocale !== false} onChange={() => toggle("autoDetectLocale")} disabled={loading} />
        </SettingsRow>

        <div>
          <label className="font-medium text-sm block mb-2">Interface Language</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(LOCALE_FLAGS || {}).map(([code, flag]) => (
              <button key={code} type="button" onClick={() => switchLocale(code)} disabled={loading}
                className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium border transition-all ${
                  locale === normalizeLocale(code)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:border-primary/40"
                }`}>
                {flag} {code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}