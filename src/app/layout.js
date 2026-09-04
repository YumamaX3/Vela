import { Inter } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "material-symbols/outlined.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { THEME_CONFIG } from "@/shared/constants/config";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

/**
 * Pre-hydration theme resolution — kills the dark-mode flash on every load.
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 * ThemeProvider calls initTheme() inside a useEffect, which runs AFTER first
 * paint. So a dark-mode user saw a light page for one frame on every single
 * load. useTheme.js has the same shape. Nothing could fix this in React: by the
 * time an effect runs, the browser has already painted.
 *
 * ── THE LOAD-BEARING DETAIL ──────────────────────────────────────────────────
 * zustand's `persist` does NOT write a bare value. From its own source
 * (middleware.mjs:360): `storage.setItem(options.name, { state, version })`,
 * wrapped by createJSONStorage's `JSON.stringify` (:300). So localStorage["theme"]
 * holds `{"state":{"theme":"dark"},"version":0}` — not `"dark"`.
 *
 * The obvious script, `if (localStorage.getItem("theme") === "dark")`, silently
 * fails on EVERY load and leaves the flash exactly where it was, while looking
 * correct. That is why this reads `.state.theme` and why the shape is documented
 * here rather than assumed: verified against zustand's source, and against
 * themeStore.js, which sets no `storage:` override — so the default
 * localStorage JSON adapter applies.
 *
 * ── Scope: first paint only ──────────────────────────────────────────────────
 * This script deliberately does NOT subscribe to matchMedia changes. useTheme.js
 * already owns that (subscribeToSystemTheme + a `theme === "system"` change
 * listener calling initTheme). Duplicating the listener here would mean two
 * sources writing the same class. This runs once, synchronously, before paint.
 *
 * ── Fail-safe ────────────────────────────────────────────────────────────────
 * Wrapped in try/catch and never throws: a corrupt or missing value, a browser
 * with localStorage disabled (private mode quota), or a JSON parse failure must
 * degrade to "leave the theme alone", never to a broken page. An unguarded throw
 * here would run in <head> and stop the rest of the document's scripts.
 *
 * ── Hydration ────────────────────────────────────────────────────────────────
 * Mutating documentElement before React hydrates would normally warn about a
 * class mismatch. <html suppressHydrationWarning> at the bottom of this file is
 * what permits it — already present, and load-bearing for this script.
 *
 * THEME_CONFIG is interpolated so the storage key and default have ONE source of
 * truth; config.js is plain data with no "use client" and no window/document
 * access, so importing it into the server component is safe (it does import
 * package.json, which Next already bundles for APP_CONFIG.version).
 */
/**
 * Escape a value for interpolation into an INLINE <script> body.
 *
 * JSON.stringify is necessary but NOT sufficient here: it does not escape `/`, so
 * a value containing `</script>` survives verbatim and terminates the script block
 * early — the classic inline-script breakout. Verified, not assumed:
 * `JSON.stringify("a</script><script>alert(1)</script>")` still contains the
 * literal `</script>`.
 *
 * Replacing < > & with their `<`-style escapes is valid JSON (so the string
 * still parses to the same value) and removes any way to spell `</script>`.
 *
 * Today both interpolated values are literals from THEME_CONFIG ("theme",
 * "system"), so nothing untrusted reaches this. The escape is defence against a
 * FUTURE edit — a default theme or storage key that ever comes from user input,
 * an env var, or a config file would otherwise become an injection point in the
 * document's <head>, the worst possible place for one.
 */
function inlineScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

const themeScript = `(function(){
  try {
    var root = document.documentElement;
    var stored = null;
    try { stored = localStorage.getItem(${inlineScriptJson(THEME_CONFIG.storageKey)}); } catch (e) { stored = null; }
    var theme = ${inlineScriptJson(THEME_CONFIG.defaultTheme)};
    if (stored) {
      var parsed = JSON.parse(stored);
      // zustand persist shape: {"state":{"theme":...},"version":N}
      if (parsed && parsed.state && typeof parsed.state.theme === "string") {
        theme = parsed.state.theme;
      }
    }
    var systemDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var isDark = theme === "dark" || (theme === "system" && systemDark);
    root.classList.toggle("dark", isDark);
  } catch (e) { /* a broken theme must never break the page */ }
})();`;

export const metadata = {
  title: "Vela — AI Gateway",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-icon.png",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme FIRST — it gates the visible flash, so it must run before any
            other inline script. The font gate below is cosmetic by comparison. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.classList.add('fonts-loaded')})}else{document.documentElement.classList.add('fonts-loaded')}`,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
        <GoogleAnalytics gaId={"G-LC959F603F"} />
      </body>
    </html>
  );
}
