// CLI Rebirth M0 Tag 1 — the x-9r-peer-token compare is constant-time
// (house pattern). This token is the key to locality itself: wrong lengths
// must reject gracefully, never throw, and a missing env token denies all.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hasTrustedPeerHeaders } from "../../src/lib/auth/trustedPeer.js";

const PEER_TOKEN = "peer-token-fixture";

function requestWith(headerValue) {
  return {
    headers: { get: (name) => (name === "x-9r-peer-token" ? headerValue : null) },
  };
}

describe("hasTrustedPeerHeaders (constant-time compare)", () => {
  beforeEach(() => {
    process.env.VELA_PEER_TOKEN = PEER_TOKEN;
  });

  afterEach(() => {
    delete process.env.VELA_PEER_TOKEN;
  });

  it("accepts the exact peer token", () => {
    expect(hasTrustedPeerHeaders(requestWith(PEER_TOKEN))).toBe(true);
  });

  it("rejects a wrong peer token", () => {
    expect(hasTrustedPeerHeaders(requestWith("guessed-token"))).toBe(false);
  });

  it("rejects wrong-length tokens gracefully (no throw)", () => {
    expect(hasTrustedPeerHeaders(requestWith("short"))).toBe(false);
    expect(hasTrustedPeerHeaders(requestWith(PEER_TOKEN + "-much-longer"))).toBe(false);
  });

  it("rejects a missing header gracefully (no throw)", () => {
    expect(hasTrustedPeerHeaders(requestWith(null))).toBe(false);
  });

  it("rejects everything when VELA_PEER_TOKEN is unset", () => {
    delete process.env.VELA_PEER_TOKEN;
    expect(hasTrustedPeerHeaders(requestWith(PEER_TOKEN))).toBe(false);
  });
});
