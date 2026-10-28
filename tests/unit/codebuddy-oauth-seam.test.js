// The OAuth seam for all four products — proven where a login silently dies.
//
// A login button can render perfectly and still be unusable. Five things have to line
// up, and a missing one fails as "undefined?platform=undefined", a 404, or a button
// that spins forever. This suite pins all five for every product.
import { describe, expect, it } from "vitest";
import { getProvider, PROVIDERS } from "../../src/lib/oauth/providers/index.js";
import {
  DEVICE_CODE_PROVIDERS,
  NO_PKCE_POLL_PROVIDERS,
} from "../../src/shared/constants/deviceCodeProviders.js";
import * as oauthConstants from "../../src/lib/oauth/constants/oauth.js";
import registry from "../../open-sse/providers/registry/index.js";
import {
  transportHeaders,
  identityHeaders,
  authPlatformForSite,
  PROVIDER_PROFILE,
} from "../../open-sse/shared/codebuddy/identity.js";

const PRODUCTS = [
  { id: "codebuddy-cn", config: "CODEBUDDY_CONFIG", platform: "CLI", domain: "copilot.tencent.com" },
  { id: "codebuddy-intl", config: "CODEBUDDY_INTL_CONFIG", platform: null, domain: "www.codebuddy.ai" },
  { id: "workbuddy-cn", config: "WORKBUDDY_CN_CONFIG", platform: "workbuddy", domain: "www.workbuddy.cn" },
  { id: "workbuddy-intl", config: "WORKBUDDY_INTL_CONFIG", platform: "workbuddy", domain: "www.workbuddy.ai" },
];

describe("every product has a resolvable OAuth handler", () => {
  for (const { id } of PRODUCTS) {
    it(`${id} resolves to a device-code provider with a live config`, () => {
      const provider = getProvider(id);
      expect(provider, `${id} has no OAuth handler`).toBeTruthy();
      expect(provider.flowType).toBe("device_code");
      // The config must be REAL, not an empty spread — this is the "undefined?platform="
      // failure in its purest form.
      expect(provider.config && typeof provider.config).toBe("object");
      expect(provider.config.stateUrl, `${id} config.stateUrl missing`).toMatch(/^https:\/\//);
      expect(provider.config.tokenUrl, `${id} config.tokenUrl missing`).toMatch(/^https:\/\//);
      expect(provider.config.refreshUrl, `${id} config.refreshUrl missing`).toMatch(/^https:\/\//);
      expect(typeof provider.config.platform).toBe("string");
      expect(provider.config.platform.length).toBeGreaterThan(0);
      expect(typeof provider.requestDeviceCode).toBe("function");
      expect(typeof provider.pollToken).toBe("function");
    });
  }

  it("registers all four in the provider map", () => {
    for (const { id } of PRODUCTS) expect(PROVIDERS[id]).toBeTruthy();
  });
});

describe("the constants are not empty spreads", () => {
  for (const { id, config } of PRODUCTS) {
    it(`${config} carries a stateUrl`, () => {
      const value = oauthConstants[config];
      expect(value, `${config} is not exported`).toBeTruthy();
      expect(Object.keys(value).length).toBeGreaterThan(0);
      expect(value.stateUrl).toMatch(/^https:\/\//);
    });
  }
});

describe("the platform law", () => {
  it("WorkBuddy sends lowercase workbuddy on BOTH shores", () => {
    expect(authPlatformForSite("cn")).toBe("workbuddy");
    expect(authPlatformForSite("intl")).toBe("workbuddy");
  });

  it("only CodeBuddy's international site requires uppercase CLI", () => {
    expect(authPlatformForSite("intl-codebuddy")).toBe("CLI");
  });

  it("both WorkBuddy registries carry the lowercase platform", () => {
    for (const id of ["workbuddy-cn", "workbuddy-intl"]) {
      expect(registry.find((p) => p.id === id).oauth.platform).toBe("workbuddy");
    }
  });
});

describe("the device-code lists gate the flow", () => {
  for (const { id } of PRODUCTS) {
    it(`${id} is in DEVICE_CODE_PROVIDERS and NO_PKCE_POLL_PROVIDERS`, () => {
      expect(DEVICE_CODE_PROVIDERS).toContain(id);
      expect(NO_PKCE_POLL_PROVIDERS).toContain(id);
    });
  }
});

describe("identity headers are each product's own", () => {
  it("CLI products say CLI; Work products say WorkBuddy", () => {
    expect(identityHeaders("cn-cli")["X-IDE-Type"]).toBe("CLI");
    expect(identityHeaders("intl-work")["X-IDE-Type"]).toBe("WorkBuddy");
  });

  it("X-Product is SaaS on every product — never the product name", () => {
    for (const profile of Object.values(PROVIDER_PROFILE)) {
      expect(transportHeaders(profile)["X-Product"]).toBe("SaaS");
    }
  });

  it("WorkBuddy carries X-Private-Data; CLI does not", () => {
    expect(identityHeaders("cn-work")["X-Private-Data"]).toBe("true");
    expect(identityHeaders("intl-work")["X-Private-Data"]).toBe("true");
    expect(identityHeaders("cn-cli")["X-Private-Data"]).toBeUndefined();
  });

  it("versions follow the shore", () => {
    expect(identityHeaders("cn-work")["X-IDE-Version"]).toBe("5.9.2");
    expect(identityHeaders("intl-work")["X-IDE-Version"]).toBe("5.8.4");
    expect(identityHeaders("cn-cli")["X-IDE-Version"]).toBe("2.165.0");
    expect(identityHeaders("intl-cli")["X-IDE-Version"]).toBe("2.161.0");
  });

  it("the international desktop client calls itself WorkBuddy AI", () => {
    expect(identityHeaders("intl-work")["User-Agent"]).toContain("WorkBuddy AI/");
    expect(identityHeaders("cn-work")["User-Agent"]).not.toContain("WorkBuddy AI/");
  });

  it("the registry transport agrees with the identity law", () => {
    for (const [id, profile] of Object.entries(PROVIDER_PROFILE)) {
      const entry = registry.find((p) => p.id === id);
      const expected = transportHeaders(profile);
      for (const [header, value] of Object.entries(expected)) {
        expect(entry.transport.headers[header], `${id} ${header}`).toBe(value);
      }
    }
  });
});
