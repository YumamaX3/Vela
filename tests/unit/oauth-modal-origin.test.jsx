// @vitest-environment happy-dom
/**
 * OAuthModal — the redirect_uri the modal sends to /authorize must ride the
 * origin the operator is actually browsing the dashboard on (localhost stays
 * localhost, LAN IP stays LAN IP), while the fixed-loopback providers keep
 * their dedicated ports.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import OAuthModal from "@/shared/components/OAuthModal";

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

const flush = async () => act(async () => {});

function authorizeResponse() {
  return {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=y",
    state: "test-state",
    codeVerifier: "test-verifier",
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OAuthModal redirect_uri derivation", () => {
  it("sends the dashboard's own origin for app-port providers", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        calls.push(String(url));
        return Promise.resolve({ ok: true, json: async () => authorizeResponse() });
      })
    );

    render(<OAuthModal isOpen provider="gemini-cli" onSuccess={() => {}} onClose={() => {}} />);
    await flush();
    await flush();

    const authorizeCall = calls.find((u) => u.includes("/api/oauth/gemini-cli/authorize"));
    expect(authorizeCall).toBeTruthy();
    const sent = new URLSearchParams(new URL(authorizeCall).search).get("redirect_uri");
    expect(sent).toBe(`${window.location.origin}/callback`);
    expect(sent).not.toContain("localhost:8080");
  });

  it("keeps codex on its dedicated loopback port", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        calls.push(String(url));
        return Promise.resolve({ ok: true, json: async () => authorizeResponse() });
      })
    );

    render(<OAuthModal isOpen provider="codex" onSuccess={() => {}} onClose={() => {}} />);
    await flush();
    await flush();

    const authorizeCall = calls.find((u) => u.includes("/api/oauth/codex/authorize"));
    expect(authorizeCall).toBeTruthy();
    const sent = new URLSearchParams(new URL(authorizeCall).search).get("redirect_uri");
    expect(sent).toBe("http://localhost:1455/auth/callback");
  });

  it("keeps xai on its dedicated loopback port", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        calls.push(String(url));
        return Promise.resolve({ ok: true, json: async () => authorizeResponse() });
      })
    );

    render(<OAuthModal isOpen provider="xai" onSuccess={() => {}} onClose={() => {}} />);
    await flush();
    await flush();

    const authorizeCall = calls.find((u) => u.includes("/api/oauth/xai/authorize"));
    expect(authorizeCall).toBeTruthy();
    const sent = new URLSearchParams(new URL(authorizeCall).search).get("redirect_uri");
    expect(sent).toBe("http://127.0.0.1:56121/callback");
  });
});
