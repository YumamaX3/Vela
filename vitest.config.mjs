import { defineConfig } from "vitest/config";
import path from "node:path";

// The repo declares its aliases in jsconfig.json but never registered them with
// vitest, so any test that transitively imports src/lib/db/paths.js failed with
// `Cannot find package '@/lib/dataDir.js'` when run by file path — including the
// pre-existing proxy-fitness-surface suite. Mirrors jsconfig.json exactly.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "open-sse": path.resolve(import.meta.dirname, "./open-sse"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js"],
  },
});
