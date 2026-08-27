import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // W3b — the happy-dom proof suites render real components. Vitest 4 runs on
  // Rolldown; the oxc parser treats a file as JSX only when its extension is
  // .jsx/.tsx (a .js file is parsed as plain JS, JSX disabled). The app
  // components therefore carry the .jsx extension; plugin-react transforms
  // them and injects the jsx runtime imports.
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js", "**/*.test.jsx"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    // .next/ is the build output — its standalone/tests/ copies of the suite
    // must NEVER be collected (they double-count every failure with stale
    // code + stale registries).
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**", "**/.next/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
    // W3b — the endpoint component proof suites run in happy-dom (a DOM
    // environment); the node suites are untouched. The docblock
    // `// @vitest-environment happy-dom` is the per-file override; the glob
    // covers the renamed .jsx suites too.
    environmentMatchGlobs: [
      ["tests/unit/endpoint-*.test.jsx", "happy-dom"],
      ["tests/unit/endpoint-*.test.js", "happy-dom"],
    ],
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
