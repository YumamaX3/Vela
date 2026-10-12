import { defineConfig } from "vitest/config";
import { transform as esbuildTransform } from "esbuild";
import path from "node:path";

// The repo declares its aliases in jsconfig.json but never registered them with
// vitest, so any test that transitively imports src/lib/db/paths.js failed with
// `Cannot find package '@/lib/dataDir.js'` when run by file path — including the
// pre-existing proxy-fitness-surface suite. Mirrors jsconfig.json exactly.
// The house convention is JSX inside .js files (Next.js parses it natively).
// Vite's import-analysis only parses JSX by extension, so a src/shared/components
// import (Drawer.js et al.) kills any render suite that touches it. This
// pre-transform mirrors tests/vitest.config.js's plugin verbatim.
function jsxInDotJs() {
  return {
    name: "vela-jsx-in-dot-js-default",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!/\.js$/.test(file) || file.includes("node_modules")) return null;
      if (!code.includes("<")) return null;
      try {
        const result = await esbuildTransform(code, {
          loader: "jsx",
          jsx: "automatic",
          sourcefile: file,
        });
        return { code: result.code, map: result.map || null };
      } catch {
        return null;
      }
    },
  };
}
export default defineConfig({
  plugins: [jsxInDotJs()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "open-sse": path.resolve(import.meta.dirname, "./open-sse"),
    },
  },
  test: {
    environment: "node",
    // .test.js + .test.jsx — the JSX suites (log-render-law, page renders)
    // are first-class; a .js file carrying JSX (proxy-console-surface, 2026-10-11
    // rename) parses only when the extension tells the truth.
    include: ["tests/unit/**/*.test.{js,jsx}"],
    // Live-network probes (e.g. mimo-free.live) hit real upstreams — they
    // answer to outages and upstream route retirements, not to this repo's
    // code, and must not gate the unit battery. Mirrors tests/vitest.config.js.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**", "tests/**/*.live.test.js"],
  },
});
