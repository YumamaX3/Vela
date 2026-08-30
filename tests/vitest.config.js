import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { transform as esbuildTransform } from "esbuild";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * The house convention is JSX inside .js files (Next.js parses it natively).
 * Vite's import-analysis (oxc under vitest 4) only parses JSX by extension,
 * so a .js component would die before any test runs. This pre-transform hands
 * those files to esbuild's jsx loader first. .jsx test files and node_modules
 * are untouched; a .js file without JSX-like syntax falls through as-is.
 */
function jsxInDotJs() {
  return {
    name: "vela-jsx-in-dot-js",
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
  test: {
    environment: "node",
    globals: true,
    // .jsx suites opt into happy-dom via a per-file docblock; the default
    // environment stays node so nothing existing shifts.
    include: ["**/*.test.js", "**/*.test.jsx"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
