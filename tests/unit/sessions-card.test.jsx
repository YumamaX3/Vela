// @vitest-environment happy-dom
// Test covenant: the session ledger's reading surface (SessionsCard).
//
// WHY THIS SUITE EXISTS: the ledger has been written since v0.9.76 and named
// since v0.9.78, and no surface ever read it — so a green API and an unread
// column looked identical from the operator's chair. The card is the window,
// and the properties worth pinning are the two distinctions it must never
// collapse:
//   • a revoked row is SHOWN (the record of a kill), not hidden — hiding it
//     would read as "never existed"
//   • the caller's own session is MARKED, so "sign out everywhere" is visibly a
//     different act from striking a stranger's row
// Plus the one that is easy to get wrong and expensive to miss: a session with
// no label must say so honestly rather than render an empty line.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SessionsCard from "@/app/(dashboard)/dashboard/profile/components/SessionsCard";

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

const flush = async () => act(async () => {});

const buttonByText = (container, label) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === label);

const ROWS = [
  {
    id: "jti-current",
    createdAt: "2026-09-21T00:00:00.000Z",
    lastSeenAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: "2026-09-22T00:00:00.000Z",
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36",
    label: "Ryzen NAS — Chrome",
    revokedAt: null,
    revokedReason: null,
    current: true,
    expired: false,
  },
  {
    id: "jti-other",
    createdAt: "2026-09-20T10:00:00.000Z",
    lastSeenAt: "2026-09-20T10:00:00.000Z",
    expiresAt: "2026-09-22T00:00:00.000Z",
    ip: "203.0.113.9",
    userAgent: "curl/8.4.0",
    label: null,
    revokedAt: null,
    revokedReason: null,
    current: false,
    expired: false,
  },
  {
    id: "jti-dead",
    createdAt: "2026-09-19T10:00:00.000Z",
    lastSeenAt: "2026-09-19T10:00:00.000Z",
    expiresAt: "2026-09-23T00:00:00.000Z",
    ip: "198.51.100.7",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
    label: "Old Laptop",
    revokedAt: "2026-09-20T11:00:00.000Z",
    revokedReason: "revoke_all",
    current: false,
    expired: false,
  },
];

const okFetch = (body) =>
  vi.fn(async () => ({ ok: true, json: async () => body }));

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SessionsCard — the ledger's reading surface", () => {
  it("renders every row the ledger holds, marks the caller's own, and names a label-less device honestly", async () => {
    vi.stubGlobal("fetch", okFetch({ sessions: ROWS, currentId: "jti-current" }));

    const { container } = render(<SessionsCard />);
    await flush();

    const text = container.textContent;
    expect(text).toContain("Ryzen NAS — Chrome");
    expect(text).toContain("Old Laptop");
    // A row with no label must SAY so, never render an empty line.
    expect(text).toContain("Unnamed device");
    expect(text).toContain("this device");
    // 2 live (the revoked row is not live), and the header says so.
    expect(text).toContain("2 live sessions");
    // Browser + OS are read out of the user agent rather than pasted raw.
    expect(text).toContain("Chrome · Windows");
    expect(text).toContain("curl");
  });

  it("SHOWS a revoked row rather than hiding it — with its reason — and offers no button to strike it twice", async () => {
    vi.stubGlobal("fetch", okFetch({ sessions: ROWS, currentId: "jti-current" }));

    const { container } = render(<SessionsCard />);
    await flush();

    const text = container.textContent;
    expect(text).toContain("revoked");
    expect(text).toContain("revoke_all");
    // The dead row is still rendered (3 rows), and it carries no action.
    const revokeButtons = Array.from(container.querySelectorAll("button")).filter((b) =>
      ["Revoke", "Sign out"].includes(b.textContent.trim())
    );
    expect(revokeButtons).toHaveLength(2);
  });

  it("strikes exactly one session through DELETE /api/auth/sessions/<id>, then re-reads the ledger", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), method: init?.method || "GET" });
        if (String(url).includes("/api/auth/sessions/jti-other")) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: true, json: async () => ({ sessions: ROWS, currentId: "jti-current" }) };
      })
    );

    const { container } = render(<SessionsCard />);
    await flush();

    const revoke = buttonByText(container, "Revoke");
    expect(revoke).toBeTruthy();
    await act(async () => {
      revoke.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toContain("/api/auth/sessions/jti-other");
    // And the ledger was re-read afterwards, so the card cannot show a stale row.
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2);
  });

  it("offers logout-everywhere with the caller's own session spared, and reports how many fell", async () => {
    const posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (init?.method === "POST") {
          posts.push({ url: String(url), body: init.body });
          return { ok: true, json: async () => ({ success: true, revoked: 2 }) };
        }
        return { ok: true, json: async () => ({ sessions: ROWS, currentId: "jti-current" }) };
      })
    );

    const { container } = render(<SessionsCard />);
    await flush();

    const open = buttonByText(container, "Revoke all");
    expect(open).toBeTruthy();
    await act(async () => {
      open.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    // The choice is offered explicitly — keeping this device is a different act.
    const keep = buttonByText(container, "Keep this device");
    expect(keep).toBeTruthy();
    await act(async () => {
      keep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain("/api/auth/sessions/revoke-all");
    expect(JSON.parse(posts[0].body)).toEqual({ keepCurrent: true });
    expect(container.textContent).toContain("Revoked 2 sessions");
  });

  it("says the ledger is empty rather than rendering a void when no session exists", async () => {
    vi.stubGlobal("fetch", okFetch({ sessions: [], currentId: null }));

    const { container } = render(<SessionsCard />);
    await flush();

    expect(container.textContent).toContain("No sessions in the ledger");
  });

  it("surfaces the route's own error line instead of a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Could not read the session ledger. Check the server logs." }),
      }))
    );

    const { container } = render(<SessionsCard />);
    await flush();

    expect(container.textContent).toContain("Could not read the session ledger.");
  });
});
