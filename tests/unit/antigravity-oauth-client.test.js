// Guards the deduped Antigravity OAuth client: same values across all 3 sources after refactor.
import { describe, it, expect } from "vitest";

const EXPECTED = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
};
const GOOGLE = {
  clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  clientSecret: "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",
};

describe("antigravity oauth client (deduped)", () => {
  it("shared source holds the canonical credentials", async () => {
    const { ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(ANTIGRAVITY_OAUTH_CLIENT).toEqual(EXPECTED);
  });

  it("registry transport keeps clientId/clientSecret", async () => {
    const ag = (await import("../../open-sse/providers/registry/antigravity.js")).default;
    expect(ag.transport.clientId).toBe(EXPECTED.clientId);
    expect(ag.transport.clientSecret).toBe(EXPECTED.clientSecret);
  });

  it("google client shared by gemini; gemini-cli rides GEMINI_CONFIG's shared spread", async () => {
    const { GOOGLE_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(GOOGLE_OAUTH_CLIENT).toEqual(GOOGLE);
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    expect(gemini.transport.clientSecret).toBe(GOOGLE.clientSecret);
    // DRIFT MEND (2026-10-11): commit 927f8449 stripped the OAuth block from
    // gemini-cli's registry entry (hidden provider, oauth.js:28 owns the law:
    // "clientId/clientSecret from GOOGLE_OAUTH_CLIENT — not stored in
    // registry"). The credential lives in src/lib/oauth/constants/oauth.js's
    // GEMINI_CONFIG = { ...GOOGLE_OAUTH_CLIENT, ...PROVIDER_OAUTH["gemini-cli"] }
    // — asserted below through the constant, not the registry transport.
    const gc = (await import("../../open-sse/providers/registry/gemini-cli.js")).default;
    expect(gc.transport?.clientSecret).toBeUndefined();
    const { GEMINI_CONFIG } = await import("../../src/lib/oauth/constants/oauth.js");
    expect(GEMINI_CONFIG.clientSecret).toBe(GOOGLE.clientSecret);
    expect(GEMINI_CONFIG.clientId).toBe(GOOGLE.clientId);
  });

  // Guard: oauth.js must spread shared clients + derive from registry (PROVIDER_OAUTH).
  it("src oauth.js imports shared client + keeps full shape", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../../src/lib/oauth/constants/oauth.js"), "utf8");
    expect(src).toContain('import { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from "open-sse/providers/shared.js"');
    expect(src).toContain("...ANTIGRAVITY_OAUTH_CLIENT");
    expect(src).toContain("...GOOGLE_OAUTH_CLIENT");
    // authorizeUrl now lives in registry; oauth.js derives via PROVIDER_OAUTH spread
    expect(src).toContain('PROVIDER_OAUTH["antigravity"]');
    expect(src).toContain('PROVIDER_OAUTH["gemini-cli"]');
    expect(src).not.toContain(EXPECTED.clientSecret); // antigravity secret no longer hardcoded here
    expect(src).not.toContain(GOOGLE.clientSecret);   // gemini secret no longer hardcoded here
  });
});
