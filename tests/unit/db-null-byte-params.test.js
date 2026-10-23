// A bound string carrying an embedded NUL cannot survive SQLite's round trip:
// better-sqlite3 rejects it ("String contains null byte") and node:sqlite keeps
// only the prefix. Telemetry writes values straight off the request — a model
// id, an endpoint, raw tool output — so the sanitizer belongs at the binding
// boundary, not at one call site.
import { describe, expect, it } from "vitest";
import { stripNullBytes } from "../../src/lib/db/helpers/nullBytes.js";

describe("stripNullBytes", () => {
  it("removes embedded NUL bytes from strings", () => {
    expect(stripNullBytes("a\0b")).toBe("ab");
    expect(stripNullBytes("\0")).toBe("");
    expect(stripNullBytes("gpt-5\0.6")).toBe("gpt-5.6");
  });

  it("leaves clean strings untouched", () => {
    expect(stripNullBytes("ok")).toBe("ok");
    expect(stripNullBytes("")).toBe("");
  });

  it("passes non-strings through unchanged", () => {
    expect(stripNullBytes(42)).toBe(42);
    expect(stripNullBytes(null)).toBe(null);
    expect(stripNullBytes(undefined)).toBe(undefined);
    expect(stripNullBytes(false)).toBe(false);
    const buf = Buffer.from("a\0b");
    expect(stripNullBytes(buf)).toBe(buf);
  });
});
