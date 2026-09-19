/**
 * OpenCode Zen is a hybrid lane (registry: hasFree + noAuth + a keyed override),
 * so the connection test has to send the credential the connection actually has.
 * Sending an empty `Bearer ` on a keyless connection reported "Invalid API key"
 * for a lane that legitimately has none — these pin the two lanes and their
 * verdicts, plus the keyless message that is not a key verdict at all.
 */
import { describe, it, expect } from "vitest";
import {
  opencodeProbeLane,
  opencodeProbeVerdict,
} from "../../src/app/api/providers/[id]/test/testUtils.js";

describe("opencodeProbeLane", () => {
  it.each([undefined, null, "", "   "])("probes the public free tier for keyless %p", (apiKey) => {
    const lane = opencodeProbeLane(apiKey);
    expect(lane.keyed).toBe(false);
    expect(lane.headers).toEqual({
      Authorization: "Bearer public",
      "User-Agent": "opencode/1.18.31",
    });
  });

  it("probes with the stored key when the connection has one", () => {
    const lane = opencodeProbeLane("zen-key-abc");
    expect(lane.keyed).toBe(true);
    expect(lane.headers).toEqual({
      Authorization: "Bearer zen-key-abc",
      "User-Agent": "opencode",
      Accept: "application/json",
    });
  });
});

describe("opencodeProbeVerdict", () => {
  it("passes a keyed probe the gate answered without an auth rejection", () => {
    expect(opencodeProbeVerdict(true, 200)).toEqual({ valid: true, error: null });
  });

  it.each([401, 403])("fails a keyed probe on %i", (status) => {
    expect(opencodeProbeVerdict(true, status)).toEqual({
      valid: false,
      error: "Invalid API key",
    });
  });

  it("passes a keyless probe on ok", () => {
    expect(opencodeProbeVerdict(false, 200)).toEqual({ valid: true, error: null });
  });

  it.each([403, 500])("reports a keyless probe %i as the free tier, never as an invalid key", (status) => {
    const verdict = opencodeProbeVerdict(false, status);
    expect(verdict.valid).toBe(false);
    expect(verdict.error).toBe("OpenCode free tier unavailable");
    expect(verdict.error).not.toMatch(/API key/);
  });
});
