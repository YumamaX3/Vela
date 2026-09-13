// P0 GOLDEN: lock buildUrl + buildHeaders cho mọi provider trên code CŨ.
// Sinh snapshot lần đầu (baseline) → sau refactor chạy lại phải khớp y hệt.
// Mock proxyFetch + uuid-heavy executors KHÔNG cần ở đây vì chỉ gọi buildUrl/buildHeaders (pure).
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

// Credentials mẫu cố định (deterministic) — KHÔNG dùng Date.now/random.
const API_KEY_CRED = { apiKey: "sk-test-APIKEY", providerSpecificData: {} };
const OAUTH_CRED = { accessToken: "tok-test-ACCESS", providerSpecificData: {} };
const SPECIAL_CRED = {
  apiKey: "sk-test-APIKEY",
  accessToken: "tok-test-ACCESS",
  providerSpecificData: { accountId: "ACC123", region: "sgp", baseUrl: "https://custom.example.com/v1", orgId: "ORG9" },
};

// Provider cần executor riêng (buildUrl/buildHeaders không nằm ở DefaultExecutor) → bỏ qua ở golden này.
// Chúng được lock riêng ở 11-provider edge tests / unit test chuyên biệt.
const SPECIALIZED = new Set([
  "antigravity", "azure", "gemini-cli", "github", "iflow", "qoder", "kiro",
  "codex", "cursor", "vertex", "vertex-partner", "opencode",
  "opencode-go", "grok-web", "perplexity-web", "ollama-local", "commandcode",
  "xiaomi-tokenplan", "mimo-free",
]);

// Sanitize header: khử token + field thời gian động (kimi X-Msh-Device-Id) để snapshot ổn định.
//
// M0 (ADR-004 The Great Fold, v0.9.62) — environment invariance, not just token masking.
// The old sanitize masked credentials only, so the snapshot silently pinned THIS machine
// (win32, v25.8.1, hostname) and THIS build number (Vela/0.9.33 ×6, X-CLIENT/CORE/Msh
// version). Consequences, both observed: cline/clinepass/kimi header blocks failed on
// EVERY version bump (v0.9.58-era standing debt), and the suite could never be green on
// CI (linux/node:22) — env-derived values differ per runner.
// Law this sanitizer encodes: the golden locks WHICH headers exist and their
// machine-independent VALUES. Anything derived from process.platform/version, os
// hostname/hardware, or package.json is a token, never a value. Masking is by KEY
// name, so claude.js's hardcoded X-Stainless-Os/Arch literals mask to the same
// tokens as shared.js's env-derived ones — the per-provider fingerprint lock that
// trade costs lives on purpose in tests/unit/claude-header-forwarding.test.js,
// which asserts those exact spoof values survive to the wire. Third-party UAs
// (claude-cli/2.1.92, gemini-cli versions, Stainless runtime/package versions)
// stay locked here: changing them must re-trip the golden.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pkg from "../../package.json" with { type: "json" };

const ENV_MASKS = {
  "x-platform": "<OS>",                      // process.platform (clineAuth.js:23)
  "x-platform-version": "<NODE>",            // process.version (clineAuth.js:24)
  "x-stainless-os": "<OS>",                  // mapStainlessOs() env-derived (shared.js:49)
  "x-stainless-arch": "<ARCH>",              // mapStainlessArch() env-derived (shared.js:50)
  "x-msh-device-name": "<HOST>",             // machine hostname (appConstants.js:233)
  "x-msh-device-model": "<MACHINE>",         // hardware model (appConstants.js:234)
  "x-client-version": "<VER>",               // pkg.version — the bump-churn class
  "x-core-version": "<VER>",
  "x-msh-version": "<VER>",
};

function sanitize(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") { out[k] = v; continue; }
    const envMask = ENV_MASKS[k.toLowerCase()];
    if (envMask) { out[k] = envMask; continue; }
    out[k] = v
      .replace(/Bearer .+/, "Bearer <TOK>")
      .replace(/sk-test-APIKEY|tok-test-ACCESS/g, "<CRED>")
      .replace(/kimi-\d{10,}/g, "kimi-<TS>")
      // Vela's own UA version is pkg.version-derived; every other UA in the tree
      // is a hardcoded spoof fingerprint and must keep its locked value.
      .replace(/\bVela\/\d+\.\d+\.\d+\b/g, "Vela/<VER>");
  }
  return out;
}

const providerIds = Object.keys(PROVIDERS).filter((p) => !SPECIALIZED.has(p)).sort();

describe("GOLDEN buildUrl (default executor providers)", () => {
  for (const pid of providerIds) {
    it(`${pid} → url (stream + non-stream)`, () => {
      const ex = new DefaultExecutor(pid);
      const cred = PROVIDERS[pid].noAuth ? {} : SPECIAL_CRED;
      const model = "test-model";
      const snap = {
        stream: safe(() => ex.buildUrl(model, true, 0, cred)),
        nonStream: safe(() => ex.buildUrl(model, false, 0, cred)),
      };
      expect(snap).toMatchSnapshot();
    });
  }
});

describe("GOLDEN buildHeaders (default executor providers)", () => {
  for (const pid of providerIds) {
    it(`${pid} → headers (apiKey / oauth)`, () => {
      const ex = new DefaultExecutor(pid);
      const snap = {
        apiKey: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : API_KEY_CRED, true))),
        oauth: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : OAUTH_CRED, true))),
        nonStream: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : API_KEY_CRED, false))),
      };
      expect(snap).toMatchSnapshot();
    });
  }
});

function safe(fn) {
  try { return fn(); } catch (e) { return `THROW: ${e.message}`; }
}

// STRUCTURAL GUARD (M0, ADR-004): the committed snapshot must carry ONLY
// masked tokens at the machine-derived/version keys. Deterministic on every
// runner (it inspects the checked-in file, not the environment). Red until the
// one-time regen lands — and red forever after if a future header smuggles an
// unmasked environment/version value back in. This is the instrument that
// makes "environment-invariant" provable rather than asserted.
describe("GOLDEN snapshot hygiene (env- & version-invariance)", () => {
  const snapText = readFileSync(
    fileURLToPath(new URL("./__snapshots__/golden-url-header.test.js.snap", import.meta.url)),
    "utf8",
  );

  it("carries no bare Vela build version", () => {
    expect(snapText).not.toMatch(/"User-Agent": "Vela\/\d/);
    expect(snapText).not.toContain(pkg.version); // the current build number must never appear
  });

  it("carries no bare app-version header values", () => {
    // Keys are upper-case in the wire shape (X-CLIENT-VERSION) and mixed in kimi's
    // (X-Msh-Version) — match case-insensitively or the guard passes vacuously.
    expect(snapText).not.toMatch(/"X-(?:CLIENT|CORE)-VERSION": "\d/i);
    expect(snapText).not.toMatch(/"X-Msh-Version": "\d/i);
  });

  it("carries no bare machine identity values", () => {
    // masked values start with "<" (OS/NODE/ARCH/HOST/MACHINE); anything else is
    // an unmasked process.platform / process.version / hostname / hardware model.
    for (const key of ["X-PLATFORM", "X-PLATFORM-VERSION", "X-Stainless-Os", "X-Stainless-Arch", "X-Msh-Device-Name", "X-Msh-Device-Model"]) {
      expect(snapText, `${key} carries an unmasked environment value`).not.toMatch(new RegExp(`"${key}": "[^<"]`));
    }
  });
});
