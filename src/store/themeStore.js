"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/config";

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      toggleTheme: () => {
        // Flip from the theme that is VISIBLE, not from the raw setting. With
        // the default `system` on a dark-OS machine the raw value is neither
        // "dark" nor "light", so the old `currentTheme === "dark" ? … : "dark"`
        // resolved system → dark and the first click changed nothing at all,
        // while the button's own label promised light. Resolving here keeps the
        // store agreeing with `useTheme`'s `isDark`, which already derives it
        // this way.
        const newTheme = resolveIsDark(get().theme) ? "light" : "dark";
        set({ theme: newTheme });
        applyTheme(newTheme);
      },

      initTheme: () => {
        const theme = get().theme;
        applyTheme(theme);
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
    }
  )
);

// Resolve whether a theme SETTING means dark right now. One source of truth:
// `applyTheme` paints from it, `toggleTheme` flips from it, and the `useTheme`
// hook derives its `isDark` the same way. A store that disagrees with its own
// hook is how the first click on `system` under a dark OS became a no-op — the
// class stayed dark while the button's label promised light.
function resolveIsDark(theme) {
  if (typeof window === "undefined") return theme === "dark";
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return theme === "dark";
}

// Apply theme to document
function applyTheme(theme) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;

  if (resolveIsDark(theme)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export default useThemeStore;

