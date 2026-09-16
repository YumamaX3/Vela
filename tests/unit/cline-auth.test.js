/**
 * ADR-004 M2 (upstream f6e7cabe rebased) — getClineAccessToken must prefix
 * ONLY WorkOS JWTs. Cline OAuth access tokens are JWTs (`eyJ…`) and the API
 * wants them `workos:`-prefixed; ClinePass API keys (`clp_…`) are opaque and
 * must pass through VERBATIM — the unconditional prefix 401'd every ClinePass
 * request ("Please make sure you are using the latest version of Cline…",
 * upstream #3230/#2333/#3644). RED FIRST: Vela's current code prefixes
 * everything, so the API-key cases are the wound's own face.
 * (Upstream shipped this suite on node:test — Vela's house is vitest; the
 * assertions are theirs, the harness is ours.)
 */
import { describe, it, expect } from "vitest";
import {
  getClineAccessToken,
  getClineAuthorizationHeader,
} from "../../open-sse/shared/clineAuth.js";

describe("getClineAccessToken — JWT-only workos: prefix", () => {
  it("keeps an existing workos: prefix (never doubles it)", () => {
    const token = "workos:eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
    expect(getClineAccessToken(token)).toBe(token);
    expect(getClineAccessToken(`  ${token}  `)).toBe(token);
  });

  it("prefixes a bare WorkOS JWT with workos:", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
    expect(getClineAccessToken(jwt)).toBe(`workos:${jwt}`);
  });

  it("does NOT prefix ClinePass API keys (the wound)", () => {
    // opaque strings — `workos:clp_…` gets 401 from api.cline.bot
    expect(getClineAccessToken("clp_1234567890abcdef")).toBe("clp_1234567890abcdef");
    expect(getClineAccessToken("sk-9r-abcdef")).toBe("sk-9r-abcdef");
    expect(getClineAccessToken("")).toBe("");
    expect(getClineAccessToken("   ")).toBe("");
    expect(getClineAccessToken(undefined)).toBe("");
    expect(getClineAccessToken(null)).toBe("");
  });

  it("case-insensitive on the existing prefix, and never on non-JWT shapes", () => {
    // lowercase workos: is the canonical form; a token merely CONTAINING eyJ
    // later (not as header) is still opaque — prefix means "this is a JWT".
    expect(getClineAccessToken("workos:eyJx.eyJy")).toBe("workos:eyJx.eyJy");
    expect(getClineAccessToken("pre-eyJ-not-a-jwt")).toBe("pre-eyJ-not-a-jwt");
  });

  it("getClineAuthorizationHeader builds Bearer without double prefixing", () => {
    expect(getClineAuthorizationHeader("clp_abc")).toBe("Bearer clp_abc");
    expect(getClineAuthorizationHeader("eyJpeg.eyJbG")).toBe("Bearer workos:eyJpeg.eyJbG");
    expect(getClineAuthorizationHeader("workos:eyJpeg.eyJbG")).toBe("Bearer workos:eyJpeg.eyJbG");
    expect(getClineAuthorizationHeader("")).toBe("");
  });
});
