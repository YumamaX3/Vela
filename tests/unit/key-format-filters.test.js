/**
 * The key fleet's filter law — the module every lens reads through
 * (`keyFormat.js`): the rail's category filter, the search needle, the sort
 * ladder, and the uncategorized sentinel.
 *
 * WHY THIS SUITE EXISTS: the keys room died in a real browser with
 *   `Uncaught ReferenceError: categoryOf is not defined`
 * thrown from a `useMemo` filter inside the room's own bundle. The module
 * re-exported `categoryOf` from `./keyLimits` (`export { categoryOf } from
 * "..."`) while `filterKeys`'s body called it — and a re-export declares no
 * local binding, so the call reached for a name the module had never bound.
 *
 * Every instrument the house owns was green: `npm run build` compiled (a bare
 * identifier is a parse success, a runtime failure) and the whole suite passed
 * because NO TEST HAD EVER IMPORTED THIS MODULE. That is the fourth instance of
 * one class across three releases — a name declared and never resolvable — so
 * this suite drives the module's real contract instead of trusting the barrel.
 */
import { describe, it, expect } from "vitest";

import {
  UNCATEGORIZED,
  categoryOf,
  filterKeys,
  matchesQuery,
  sortKeys,
} from "@/app/(dashboard)/dashboard/endpoint/lib/keyFormat.js";

const KEYS = [
  { id: "a", name: "friend", category: "friend", description: "shared with a friend", keyPrefix: "vk_aaa", createdAt: "2026-01-01T00:00:00Z" },
  { id: "b", name: "hermes", category: "hermes", description: "agent key", keyPrefix: "vk_bbb", createdAt: "2026-01-02T00:00:00Z" },
  { id: "c", name: "stray", description: "no category at all", keyPrefix: "vk_ccc", createdAt: "2026-01-03T00:00:00Z" },
];

const ids = (list) => list.map((k) => k.id);

describe("categoryOf", () => {
  it("reads a key's own category", () => {
    expect(categoryOf(KEYS[0])).toBe("friend");
  });

  it("files a key with no category under the sentinel bucket", () => {
    expect(categoryOf(KEYS[2])).toBe(UNCATEGORIZED);
  });
});

describe("filterKeys — the rail's category", () => {
  it("keeps only the keys filed under the chosen category", () => {
    expect(ids(filterKeys(KEYS, { category: "friend" }))).toEqual(["a"]);
  });

  it("keeps only the uncategorized keys for the sentinel filter", () => {
    expect(ids(filterKeys(KEYS, { category: UNCATEGORIZED }))).toEqual(["c"]);
  });

  it("returns the whole fleet for the all filter", () => {
    expect(ids(filterKeys(KEYS, { category: "all" }))).toEqual(["a", "b", "c"]);
  });
});

describe("filterKeys — the search needle", () => {
  it("matches the name", () => {
    expect(ids(filterKeys(KEYS, { query: "herm" }))).toEqual(["b"]);
  });

  it("matches the description and the prefix", () => {
    expect(ids(filterKeys(KEYS, { query: "agent" }))).toEqual(["b"]);
    expect(ids(filterKeys(KEYS, { query: "vk_ccc" }))).toEqual(["c"]);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(ids(filterKeys(KEYS, { query: "  FRIEND " }))).toEqual(["a"]);
  });

  it("matches nothing when the needle is absent", () => {
    expect(ids(filterKeys(KEYS, { query: "nowhere" }))).toEqual([]);
  });
});

describe("filterKeys — the derived posture", () => {
  it("filters by a posture verdict rather than a stored field", () => {
    // Posture is derived from the ceilings, never stored — so an expired key is
    // 'expired' by its date alone, and a plain key is 'active'.
    const fleet = [
      { ...KEYS[0], id: "x", expiresAt: "2020-01-01T00:00:00Z" },
      { ...KEYS[1], id: "y" },
    ];
    expect(ids(filterKeys(fleet, { posture: "expired" }))).toEqual(["x"]);
    expect(ids(filterKeys(fleet, { posture: "active" }))).toEqual(["y"]);
  });
});

describe("matchesQuery", () => {
  it("treats an empty needle as no filter", () => {
    expect(matchesQuery(KEYS[0], "")).toBe(true);
    expect(matchesQuery(KEYS[0], "   ")).toBe(true);
  });
});

describe("sortKeys", () => {
  it("sorts by creation date, newest first under the default descending order", () => {
    expect(ids(sortKeys(KEYS, "created", "desc"))).toEqual(["c", "b", "a"]);
  });

  it("reverses when the direction is ascending", () => {
    expect(ids(sortKeys(KEYS, "created", "asc"))).toEqual(["a", "b", "c"]);
  });

  it("sorts by name", () => {
    expect(ids(sortKeys(KEYS, "name", "asc"))).toEqual(["a", "b", "c"]);
  });
});
