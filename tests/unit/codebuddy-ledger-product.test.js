// M1 — the ledger must name the product its row belongs to.
//
// Before this tide, `createLedgerStorage.write` stamped EVERY row with
// `CODEBUDDY_BREAKER_PROVIDERS[0]` — "codebuddy-cn" — so a WorkBuddy cooldown was
// persisted as a CodeBuddy one. A cooldown that names the wrong lane cools the
// wrong account. The row now reads its product from its own key, and a key that
// names no family provider is refused rather than guessed.

import { describe, it, expect } from "vitest";
import { providerForKey, CODEBUDDY_BREAKER_PROVIDERS } from "../../open-sse/shared/codebuddy/breakerLedger.js";

describe("breakerLedger · the row names its product", () => {
  it("resolves each of the four products from its key prefix", () => {
    for (const id of CODEBUDDY_BREAKER_PROVIDERS) {
      expect(providerForKey(`${id}:conn-1`)).toBe(id);
    }
  });

  it("splits only on the FIRST colon, so a connection id may contain colons", () => {
    expect(providerForKey("workbuddy-intl:a:b:c")).toBe("workbuddy-intl");
  });

  it("refuses a key that names no family provider", () => {
    expect(providerForKey("openai:conn-1")).toBeNull();
    expect(providerForKey("noprefix")).toBeNull();
    expect(providerForKey(":conn-1")).toBeNull();
    expect(providerForKey("")).toBeNull();
    expect(providerForKey(null)).toBeNull();
  });

  it("names the product the key carries, never the first provider by default", () => {
    // The old lie: every row came back as CODEBUDDY_BREAKER_PROVIDERS[0].
    // The truth: a key resolves to whatever product it names.
    expect(providerForKey("workbuddy-cn:abc")).toBe("workbuddy-cn");
    expect(providerForKey("workbuddy-intl:abc")).toBe("workbuddy-intl");
    expect(providerForKey("codebuddy-intl:abc")).toBe("codebuddy-intl");
    // An unrecognised prefix must be refused, never quietly filed under the first.
    expect(providerForKey("stranger:abc")).toBeNull();
  });
});
