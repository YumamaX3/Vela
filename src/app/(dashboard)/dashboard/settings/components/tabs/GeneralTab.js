"use client";
// General — how this instance looks and where its data lives.
//
// The old room opened with a "Local Mode" card whose title was a lie on a remote
// host (`isRemoteHost` was already measured, and only printed at the very bottom
// of a 1,710-line page). The masthead now answers that question once, honestly,
// so this tab carries only what it actually owns: theme, language, and the
// database path.
//
// The backup ACTIONS moved to Data — General tells you where the file is, Data
// is where you move it. Two tabs, two questions, no card that does both.
import { useState } from "react";
import { Card, LanguageSwitcher } from "@/shared/components";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

const THEME_ICONS = { light: "light_mode", dark: "dark_mode", system: "contrast" };

export default function GeneralTab() {
  const { theme, setTheme } = useTheme();
  const [locale, setLocale] = useState(() => getLocaleFromCookie());
  const [langOpen, setLangOpen] = useState(false);

  return (
    <>
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">palette</span>
          </div>
          <div>
            <h3 className="text-text-main font-semibold">Appearance</h3>
            <p className="text-sm text-text-muted mt-0.5">
              Applies to this browser only.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-text-main">Theme</p>
              <p className="text-sm text-text-muted mt-0.5">
                Follow the system or pin one.
              </p>
            </div>
            <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5 shrink-0">
              {["light", "dark", "system"].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  aria-pressed={theme === option}
                  className={cn(
                    "flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md font-medium text-xs sm:text-sm motion-control",
                    theme === option
                      ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                      : "text-text-muted hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
                    {THEME_ICONS[option]}
                  </span>
                  <span className="capitalize">{option}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-border-subtle">
            <p className="font-medium text-sm text-text-main mb-2">Language</p>
            <button
              onClick={() => setLangOpen(true)}
              className="flex items-center justify-between w-full p-3 rounded-[10px] bg-bg border border-border-subtle hover:border-brand-500/50 motion-control"
              data-i18n-skip="true"
            >
              <span className="text-sm text-text-muted">Display language</span>
              <span className="text-2xl">{LOCALE_FLAGS[locale] || "🌐"}</span>
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">storage</span>
          </div>
          <div>
            <h3 className="text-text-main font-semibold">Database</h3>
            <p className="text-sm text-text-muted mt-0.5">
              Where keys, usage, sessions and settings are stored.
            </p>
          </div>
        </div>
        {/* Read-only on purpose: the location is chosen by the deployment (DATA_DIR
            / VELA_DB_MODE), never by a form in the dashboard. Editing it here would
            be a control that cannot work. */}
        <div className="p-3 rounded-[10px] bg-bg border border-border-subtle">
          <p className="font-medium text-sm text-text-main">Location</p>
          <p className="text-sm text-text-muted font-mono break-all mt-0.5">~/.vela/db/data.sqlite</p>
        </div>
      </Card>

      <LanguageSwitcher
        hideTrigger
        isOpen={langOpen}
        onClose={(next) => {
          setLangOpen(false);
          setLocale(next);
        }}
      />
    </>
  );
}
