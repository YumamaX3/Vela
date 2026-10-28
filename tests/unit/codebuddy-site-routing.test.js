// The four-product law, proven at its refusals.
//
// Routing is where a wrong answer is expensive: a domestic token dialled at an
// international host fails in a way that looks like a credential problem, and a
// hint that is quietly "normalized" into something routable is worse than a refusal.
// Every assertion below pins an edge that must NOT be crossed.
import { describe, expect, it } from "vitest";
import {
  CODEBUDDY_PROFILES,
  CODEBUDDY_DOMAINS,
  profileRegion,
  profileProduct,
  profileEndpoint,
  chatUrlForProfile,
  normalizeDomain,
  tokenIssuer,
  siteForCredential,
  profileForCredential,
  domainForCredential,
  CodeBuddyRoutingError,
} from "../../open-sse/shared/codebuddy/siteRouting.js";

/** Build an unsigned JWT whose payload carries `iss`. */
function jwt(payload) {
  const enc = (obj) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}

describe("the four products and their endpoints", () => {
  it("names exactly four", () => {
    expect(Object.keys(CODEBUDDY_PROFILES)).toEqual(["cn-cli", "cn-work", "intl-cli", "intl-work"]);
  });

  it("maps each profile to its own host", () => {
    expect(profileEndpoint("cn-cli")).toBe("https://copilot.tencent.com");
    expect(profileEndpoint("cn-work")).toBe("https://www.workbuddy.cn");
    expect(profileEndpoint("intl-cli")).toBe("https://www.codebuddy.ai");
    expect(profileEndpoint("intl-work")).toBe("https://www.workbuddy.ai");
  });

  it("derives shore and product from the profile name", () => {
    expect(profileRegion("cn-work")).toBe("domestic");
    expect(profileRegion("intl-cli")).toBe("international");
    expect(profileProduct("intl-work")).toBe("workbuddy");
    expect(profileProduct("cn-cli")).toBe("cli");
  });

  it("shares ONE chat path across all four — measured, not assumed", () => {
    // The reference builds every profile's chat door as
    // PROFILE_ENDPOINTS[profile] + "/v2/chat/completions", so the four differ only
    // in host. A per-profile buildUrl override would be ceremony without a cause.
    for (const profile of Object.keys(CODEBUDDY_PROFILES)) {
      const url = chatUrlForProfile(profile);
      expect(url.endsWith("/v2/chat/completions")).toBe(true);
      expect(url.startsWith(CODEBUDDY_PROFILES[profile])).toBe(true);
    }
    expect(chatUrlForProfile("intl-work")).toBe("https://www.workbuddy.ai/v2/chat/completions");
    expect(chatUrlForProfile("cn-work")).toBe("https://www.workbuddy.cn/v2/chat/completions");
  });

  it("refuses a profile it does not know", () => {
    expect(() => profileEndpoint("intl")).toThrow(CodeBuddyRoutingError);
    expect(() => profileRegion("us-cli")).toThrow(CodeBuddyRoutingError);
  });
});

describe("a hint must name a known host, exactly", () => {
  it("accepts the four known hosts", () => {
    for (const host of Object.keys(CODEBUDDY_DOMAINS)) {
      expect(normalizeDomain(host)).toBe(host);
      expect(normalizeDomain(`https://${host}`)).toBe(host);
    }
  });

  it("refuses an unknown host", () => {
    for (const bad of ["evil.com", "www.codebuddy.ai.evil.com", "codebuddy.ai", "127.0.0.1"]) {
      expect(() => normalizeDomain(bad)).toThrow(CodeBuddyRoutingError);
    }
  });

  it("refuses a port, userinfo, query, fragment or path", () => {
    for (const bad of [
      "https://www.codebuddy.ai:8443",
      "https://user:pass@www.codebuddy.ai",
      "https://www.codebuddy.ai/?x=1",
      "https://www.codebuddy.ai/#frag",
      "https://www.codebuddy.ai/v2/chat",
      "www.codebuddy.ai\\@evil.com",
    ]) {
      expect(() => normalizeDomain(bad)).toThrow(CodeBuddyRoutingError);
    }
  });

  it("allows a path only for an issuer claim", () => {
    expect(() => normalizeDomain("https://www.codebuddy.ai/v2", { issuer: true })).not.toThrow();
  });

  it("refuses plain http and junk", () => {
    expect(() => normalizeDomain("http://www.codebuddy.ai")).toThrow(CodeBuddyRoutingError);
    expect(() => normalizeDomain("")).toThrow(CodeBuddyRoutingError);
    expect(() => normalizeDomain(null)).toThrow(CodeBuddyRoutingError);
  });
});

describe("the issuer is read, never trusted", () => {
  it("extracts iss from a well-formed token", () => {
    expect(tokenIssuer(jwt({ iss: "https://www.workbuddy.ai" }))).toBe("https://www.workbuddy.ai");
  });

  it("returns null for anything malformed", () => {
    for (const bad of ["", "a.b", "not.a.jwt.at.all", null, 42]) {
      expect(tokenIssuer(bad)).toBe(null);
    }
  });
});

describe("routing follows the credential's own hints", () => {
  it("uses the stored domain", () => {
    expect(profileForCredential({ domain: "www.codebuddy.ai" })).toBe("intl-cli");
    expect(profileForCredential({ domain: "www.workbuddy.cn" })).toBe("cn-work");
  });

  it("falls back to the issuer claim", () => {
    expect(profileForCredential({ accessToken: jwt({ iss: "https://www.workbuddy.ai" }) }))
      .toBe("intl-work");
  });

  it("defaults to the domestic CLI when no hint survives", () => {
    expect(siteForCredential({})).toBe("domestic");
    expect(profileForCredential({})).toBe("cn-cli");
    expect(domainForCredential({})).toBe("www.codebuddy.cn");
  });

  it("cannot tell CLI from Work on the shared domestic endpoint", () => {
    // copilot.tencent.com is shared, so it must not be read as branding.
    expect(profileForCredential({ domain: "copilot.tencent.com" })).toBe("cn-cli");
    expect(profileForCredential({ domain: "copilot.tencent.com", accessToken: jwt({ iss: "https://www.workbuddy.cn" }) }))
      .toBe("cn-work");
  });

  it("raises on two hints naming different shores", () => {
    expect(() => siteForCredential({
      domain: "www.codebuddy.ai",
      accessToken: jwt({ iss: "https://www.codebuddy.cn" }),
    })).toThrow(/Conflicting credential sites/);
  });

  it("raises on two hints naming different products", () => {
    expect(() => profileForCredential({
      domain: "www.codebuddy.ai",
      accessToken: jwt({ iss: "https://www.workbuddy.ai" }),
    })).toThrow(/Conflicting credential products/);
  });
});
