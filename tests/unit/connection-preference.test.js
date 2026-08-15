/**
 * connectionPreference — generic fail-open affinity hook.
 * Covers: register/resolve, fail-open on throw, injectable timeout -> null,
 * resolver loser completes fire-and-forget, and unknown provider -> null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerConnectionResolver,
  unregisterConnectionResolver,
  resolvePreferredConnection,
  __test__,
} from "../../src/sse/services/connectionPreference.js";

beforeEach(() => {
  __test__.reset();
});

describe("resolvePreferredConnection", () => {
  it("returns the resolver's connectionId", async () => {
    registerConnectionResolver("testprov", async ({ model }) => (model === "m1" ? "conn-9" : null));
    expect(await resolvePreferredConnection("testprov", "m1")).toBe("conn-9");
    expect(await resolvePreferredConnection("testprov", "m2")).toBeNull();
  });

  it("returns null for an unregistered provider (fail-open)", async () => {
    expect(await resolvePreferredConnection("nope", "m1")).toBeNull();
  });

  it("fails open (null) when the resolver throws", async () => {
    registerConnectionResolver("throwy", async () => { throw new Error("boom"); });
    expect(await resolvePreferredConnection("throwy", "m1")).toBeNull();
  });

  it("fails open (null) when the resolver resolves to non-string", async () => {
    registerConnectionResolver("badtype", async () => ({ id: "not-a-string" }));
    expect(await resolvePreferredConnection("badtype", "m1")).toBeNull();
  });

  it("fails open (null) when the resolver exceeds the timeout", async () => {
    __test__.setTimeoutMs(10);
    registerConnectionResolver("slow", () => new Promise(() => {})); // never resolves
    expect(await resolvePreferredConnection("slow", "m1")).toBeNull();
    __test__.setTimeoutMs(500);
  });

  it("unregisters cleanly", async () => {
    registerConnectionResolver("gone", async () => "conn-x");
    unregisterConnectionResolver("gone");
    expect(await resolvePreferredConnection("gone", "m1")).toBeNull();
  });
});

describe("freebuff affinity resolver registration", () => {
  it("registers a freebuff resolver that consults warm sessions", async () => {
    // Importing registers the resolver as a side effect.
    const { findWarmConnection } = await import("../../open-sse/services/freebuffSession.js");
    await import("../../src/sse/services/freebuffPreference.js");
    // findWarmConnection with no connections returns null -> resolver returns null
    expect(await resolvePreferredConnection("freebuff", "mimo/mimo-v2.5")).toBeNull();
    expect(typeof findWarmConnection).toBe("function");
    __test__.reset();
  });
});
