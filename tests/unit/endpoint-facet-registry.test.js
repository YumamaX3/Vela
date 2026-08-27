// Test covenant: facetRegistry — the URL trust boundary (W1d, S8).
// Unknown dropped, enums whitelisted, sort allowlisted, q capped,
// round-trip idempotent.
import { describe, it, expect } from "vitest";
import { parseParams, buildParams, mergeFacets, FACET_KEYS } from "@/lib/endpoint/facetRegistry.js";

describe("facetRegistry — validation boundary", () => {
  it("parses valid facets", () => {
    const { state, rejected } = parseParams("tab=keys&status=active&sort=name&dir=asc");
    expect(state.tab).toBe("keys");
    expect(state.status).toBe("active");
    expect(state.sort).toBe("name");
    expect(state.dir).toBe("asc");
    expect(rejected).toHaveLength(0);
  });

  it("drops unknown facet keys + reports them", () => {
    const { state, rejected } = parseParams("tab=keys&evil=<script>&__proto__=x");
    expect(state.tab).toBe("keys");
    expect(rejected).toContain("evil");
    expect(rejected).toContain("__proto__");
  });

  it("enum violation falls back to default + counts rejected", () => {
    const { state, rejected } = parseParams("status=hacked&sort=DROP%20TABLE");
    expect(state.status).toBe("all");
    expect(state.sort).toBe("lastUsedAt");
    expect(rejected).toContain("status");
    expect(rejected).toContain("sort");
  });

  it("caps oversized q + category", () => {
    const { state, rejected } = parseParams(`q=${"x".repeat(300)}&category=${"y".repeat(100)}`);
    expect(state.q.length).toBe(120);
    expect(state.category.length).toBe(64);
    expect(rejected.length).toBe(2);
  });

  it("page clamped to [0, 10000]", () => {
    expect(parseParams("page=999999999").state.page).toBe(10000);
    expect(parseParams("page=-5").state.page).toBe(0);
    expect(parseParams("page=abc").state.page).toBe(0);
  });

  it("sel is an id-whitelisted array capped at 5", () => {
    const { state } = parseParams(`sel=${encodeURIComponent(JSON.stringify(["abc12345", "bad id!", "x".repeat(10)]))}`);
    expect(state.sel).toEqual(["abc12345", "x".repeat(10)]);
    expect(state.sel.length).toBeLessThanOrEqual(5);
  });

  it("round-trip idempotent: parse(build(parse(u))) == parse(u)", () => {
    const u = "tab=audit&status=revoked&q=hello%20world&sort=risk";
    const first = parseParams(u);
    const rebuilt = parseParams(buildParams(first.state));
    expect(rebuilt.state).toEqual(first.state);
  });

  it("buildParams omits defaults, stable order", () => {
    const s = { tab: "overview", status: "all", q: "", sort: "lastUsedAt", dir: "desc", category: "", page: 0, sel: [] };
    expect(buildParams(s)).toBe("");
  });

  it("mergeFacets only accepts registered keys", () => {
    const base = parseParams("").state;
    const next = mergeFacets(base, { tab: "tools", evil: "x" });
    expect(next.tab).toBe("tools");
    expect("evil" in next).toBe(false);
    expect(FACET_KEYS).toContain("tab");
  });
});
