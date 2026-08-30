/**
 * OAuth callback host derivation — "back into what Vela got accessed."
 * The helper derives the callback origin from the request's actual access
 * point: localhost stays localhost, a LAN IP stays that LAN IP.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getCallbackOrigin, getBrowserCallbackOrigin } from "@/lib/oauth/utils/redirect";

/** Build a Request shaped like a Next.js App Router request. */
function req({ host, url = "http://127.0.0.1:32060/api/oauth/gemini-cli/authorize", realIp, forwardedHost, forwardedProto }) {
  const headers = new Headers();
  if (host) headers.set("host", host);
  if (realIp) headers.set("x-9r-real-ip", realIp);
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);
  if (forwardedProto) headers.set("x-forwarded-proto", forwardedProto);
  return new Request(url, { headers });
}

describe("getCallbackOrigin — the callback returns to the shore it came from", () => {
  beforeEach(() => {
    delete process.env.BASE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });
  afterEach(() => {
    delete process.env.BASE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.unstubAllGlobals();
  });

  it("keeps localhost when the dashboard is browsed on localhost", () => {
    expect(getCallbackOrigin(req({ host: "localhost:32060" }))).toBe("http://localhost:32060");
  });

  it("keeps a LAN IP when the dashboard is browsed on a LAN IP", () => {
    expect(getCallbackOrigin(req({ host: "192.168.1.20:32060" }))).toBe("http://192.168.1.20:32060");
  });

  it("keeps a hostname when the dashboard is browsed on one", () => {
    expect(getCallbackOrigin(req({ host: "vela.homelab.local:32060" }))).toBe("http://vela.homelab.local:32060");
  });

  it("hops to https when the request URL is https", () => {
    const r = req({ host: "gateway.example.com", url: "https://gateway.example.com/api/oauth/x/authorize" });
    expect(getCallbackOrigin(r)).toBe("https://gateway.example.com");
  });

  it("hons forwarded host only for a loopback peer", () => {
    const loopback = req({
      host: "localhost:32060",
      realIp: "127.0.0.1",
      forwardedHost: "vela.tailscale.example",
      forwardedProto: "https",
    });
    expect(getCallbackOrigin(loopback)).toBe("https://vela.tailscale.example");
  });

  it("ignores forged forwarded headers from a remote peer (spoof guard)", () => {
    const remote = req({
      host: "192.168.1.20:32060",
      realIp: "203.0.113.7",
      forwardedHost: "attacker.example",
      forwardedProto: "https",
    });
    expect(getCallbackOrigin(remote)).toBe("http://192.168.1.20:32060");
  });

  it("falls back to BASE_URL when no host header rides the request", () => {
    process.env.BASE_URL = "http://192.168.1.20:32060";
    const bare = new Request("http://127.0.0.1:32060/api/oauth/x/authorize");
    expect(getCallbackOrigin(bare)).toBe("http://192.168.1.20:32060");
  });

  it("lands on the safe localhost default when all else is dark", () => {
    expect(getCallbackOrigin(null)).toBe("http://localhost:32060");
  });
});

describe("getBrowserCallbackOrigin — the client side of the same law", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.window;
  });

  it("returns the localhost default when no window exists (SSR)", () => {
    expect(getBrowserCallbackOrigin()).toBe("http://localhost:32060");
  });

  it("echoes the origin the operator browses on", () => {
    globalThis.window = { location: { origin: "http://192.168.1.20:32060/" } };
    expect(getBrowserCallbackOrigin()).toBe("http://192.168.1.20:32060");
  });
});
