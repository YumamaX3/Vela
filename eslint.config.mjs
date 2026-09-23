import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // ── `no-undef` — the class that darkened two rooms in two releases (v0.9.91) ──
  //
  // A name declared and never resolvable is a PARSE SUCCESS and a RUNTIME
  // failure: `next build` compiles it, and a suite that never imports the file
  // never sees it. That is how v0.9.89 shipped a key room answering 500 on every
  // door, and how v0.9.90's `key` rename half-landed — and how `ClaudeToolCard`
  // lost its vault import at v0.9.71 while keeping every call.
  //
  // The rule was simply never lit: the config spreads `core-web-vitals` alone,
  // whose ruleset has no `no-undef`. Measured across `src` + `open-sse` (1,210
  // modules) it surfaces 6 findings — all real — against 149 errors from the
  // other rules, so it costs nothing and covers the exact class the build and the
  // suite are both blind to. The globals it needs are ALREADY here: the next
  // config's first block declares 1,174 of them, so this adds no dependency.
  //
  // Honest scope: this rule runs when a developer or agent runs `npx eslint`.
  // There is no CI lint gate in this repo, so it is a hand-run instrument, not a
  // machine barrier — the render suites under `tests/unit/*.test.jsx` are the
  // executed guards. Both are recorded as such in the release notes.
  {
    rules: {
      "no-undef": "error",
    },
  },
  // The service worker's own global. `clients` exists only in a SW scope, and
  // next's 1,174 globals are the window/node sets.
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: { clients: "readonly", self: "readonly" },
    },
  },
  // The test shore: vitest runs with `globals: true`, and the two `.cjs`
  // node:test suites sit outside the file patterns next's globals block matches.
  {
    files: ["tests/**/*.{js,jsx,cjs,mjs}"],
    languageOptions: {
      globals: {
        // vitest's globals (tests/vitest.config.js: `globals: true`)
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        afterAll: "readonly",
        afterEach: "readonly",
        // node's, for the .cjs suites
        Buffer: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
  },
]);

export default eslintConfig;
