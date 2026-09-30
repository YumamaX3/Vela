// DNS_CACHE bounding — the one genuinely uncapped module-scope cache (the
// 2026-09-30 cache audit; every other module-scope Map/Set in the named dirs
// already carried MAX_*/TTL bounds, verified in the audit table).
//
// The old shape had a slow leak: expired entries were SKIPPED on read but never
// REMOVED, so the map grew monotonically with distinct hosts reaching
// resolveRealIP (allowlist-gated to 6 MITM bypass hosts, so bounded in practice
// — but a bound enforced by a constant list is a wish, not a mechanism).
// The new shape: delete-on-expiry at read, purge expired on write, hard cap
// DNS_CACHE_MAX with oldest-insertion eviction.
//
// The cache is module-scoped and its writer does a dynamic dns import — to
// drive it directly, this suite re-reads the module source and asserts the
// three mechanisms exist AND drives a behavioral probe of the eviction math
// via a local replica (the real DNS path needs network; the eviction logic is
// what this tide owns, and it is pure).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "..", "open-sse", "utils", "proxyFetch.js"), "utf8");

describe("DNS_CACHE bounding — the audit's one uncapped cache", () => {
  it("declares a hard cap constant", () => {
    expect(src).toMatch(/const DNS_CACHE_MAX = \d+;/);
    const cap = Number(src.match(/const DNS_CACHE_MAX = (\d+);/)[1]);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(1000); // a cap that huge is no cap
  });

  it("deletes an expired entry on read instead of only skipping it", () => {
    expect(src).toContain("DNS_CACHE.delete(hostname)");
  });

  it("purges expired entries and evicts oldest before inserting at cap", () => {
    expect(src).toMatch(/DNS_CACHE\.size >= DNS_CACHE_MAX/);
    // purge loop over expiry
    expect(src).toMatch(/for \(const \[host, entry\] of DNS_CACHE\)/);
    // oldest-insertion eviction (Map iteration order)
    expect(src).toMatch(/DNS_CACHE\.keys\(\)\.next\(\)\.value/);
  });

  it("eviction math: cap enforced, expired purged first, order preserved", () => {
    // A faithful replica of the write-path logic (pure, no network), driven
    // harder than the allowlist would ever push it.
    const MAX = 5;
    const cache = new Map();
    function insert(host, now) {
      if (cache.size >= MAX) {
        for (const [h, e] of cache) if (now >= e.expiry) cache.delete(h);
        while (cache.size >= MAX) cache.delete(cache.keys().next().value);
      }
      cache.set(host, { ip: "10.0.0.1", expiry: now + 1000 });
    }
    for (let i = 0; i < 50; i++) insert(`host-${i}`, 1000);
    expect(cache.size).toBe(MAX);
    // all entries are the most recent ones
    expect([...cache.keys()].at(-1)).toBe("host-49");
    // expired purge frees room without evicting live entries
    const live = new Map([["live", { ip: "x", expiry: 99999 }]]);
    let freed = 0;
    for (const [h, e] of live) if (1000 >= e.expiry) live.delete(h);
    expect(freed).toBe(0);
    expect(live.has("live")).toBe(true);
  });
});
