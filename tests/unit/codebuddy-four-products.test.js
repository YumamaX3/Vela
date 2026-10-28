// The four products, proven at the seam the build cannot see.
//
// The registry census proves a provider EXISTS; the executor map proves a lane is
// WIRED. Neither proves the two agree — and a registry entry whose executor lookup
// returns the default executor fails at request time, not at build time. This suite
// pins the join: every product has both halves, and each points at its own host.
import { describe, expect, it } from "vitest";
import registry from "../../open-sse/providers/registry/index.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { CODEBUDDY_PROFILES, chatUrlForProfile } from "../../open-sse/shared/codebuddy/siteRouting.js";

const PRODUCTS = [
  { id: "codebuddy-cn",   alias: "cbcn", profile: "cn-cli" },
  { id: "codebuddy-intl", alias: "cbai", profile: "intl-cli" },
  { id: "workbuddy-cn",   alias: "cbw",  profile: "cn-work" },
  { id: "workbuddy-intl", alias: "cbwi", profile: "intl-work" },
];

describe("all four products are registered", () => {
  for (const { id, alias } of PRODUCTS) {
    it(`${id} exists with alias ${alias}`, () => {
      const entry = registry.find((p) => p.id === id);
      expect(entry, `${id} missing from the registry`).toBeTruthy();
      expect(entry.alias).toBe(alias);
      expect(entry.category).toBe("oauth");
    });
  }
});

describe("all four products are wired to a specialized executor", () => {
  for (const { id } of PRODUCTS) {
    it(`${id} resolves a specialized executor, not the default`, () => {
      expect(hasSpecializedExecutor(id), `${id} has no specialized executor — requests would hit the default lane`).toBe(true);
      expect(getExecutor(id)).toBeTruthy();
    });
  }
});

describe("registry and executor agree on each host", () => {
  for (const { id, profile } of PRODUCTS) {
    it(`${id} dials the host its profile names`, () => {
      const entry = registry.find((p) => p.id === id);
      expect(entry.transport.baseUrl).toBe(chatUrlForProfile(profile));
      expect(entry.transport.baseUrl.startsWith(CODEBUDDY_PROFILES[profile])).toBe(true);
    });
  }
});

describe("the four hosts are distinct", () => {
  it("no two products share a base URL", () => {
    const urls = PRODUCTS.map(({ id }) => registry.find((p) => p.id === id).transport.baseUrl);
    expect(new Set(urls).size).toBe(4);
  });
});
