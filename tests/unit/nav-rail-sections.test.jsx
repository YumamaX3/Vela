// @vitest-environment happy-dom
/**
 * The helm's section contract — the invariant, pinned.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * v0.9.x shipped a nav whose section state was dead: `Sidebar` held a
 * `selected` state the click handlers wrote and nothing read, so on
 * `/dashboard` nineteen of the twenty rooms were unreachable. It was found by
 * walking the live dock in a browser — not by a test, because the standing
 * suites never mounted the surface. This file exists so the same class of
 * defect cannot ship silently twice: it mounts the REAL component and pins
 * the contract the v1.0.42 rebuild inherited and the v1.0.43 rebuild carries:
 *
 * **the URL decides the section; a header's only job is to move the URL.**
 *
 * In the single-column accordion the section the URL names is the one whose
 * rooms render; every other header sits closed. There is no second state —
 * `aria-expanded` is derived, not stored — so the state cannot drift from the
 * route, because there is nothing left to drift.
 *
 * `push` mutates the mocked pathname and the component is re-rendered, which is
 * exactly what Next's router does after a push (route commit → `usePathname`
 * reports the new path → the tree re-renders). No layout is read, so this is
 * happy-dom-safe.
 *
 * Mutation check: make `goToSection` a no-op (a header that opens nothing) and
 * the navigation cases redden at `pushCalls`; make `activeSectionId` read a
 * stored state instead of the pathname and the route-decides cases redden.
 *
 * ── Scope: which half of the contract this owns ─────────────────────────────
 * This file mocks the router and commits the route by mutating `currentPath`, so
 * it proves the CONSUMER — click → the intended href → the derived section →
 * `aria-expanded` → the rooms. It cannot prove the PRODUCER, i.e. that Next's
 * own `router.push` really navigates and that `usePathname` reports the new
 * route in a live browser; a mock answering its own question is not evidence
 * about the real one. That half is covered by a browser walk. Neither
 * instrument alone closes the class — together they do, and the next keeper
 * should know which one they are holding.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
let currentPath = "/dashboard";
const pushCalls = [];
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  useRouter: () => ({
    push: (href) => { pushCalls.push(href); currentPath = href; },
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a>,
}));
import Sidebar from "@/shared/components/Sidebar";

let container;
let root;
/** Re-render — this is the route commit that follows a push. */
const commit = async () => { await act(async () => { root.render(<Sidebar />); }); };
const sections = () => [...container.querySelectorAll(".nav-sec-btn")];
const expandedId = () =>
  sections().find((b) => b.getAttribute("aria-expanded") === "true")?.dataset.sectionId || null;
const sec = (id) => sections().find((b) => b.dataset.sectionId === id);
const tileLabels = () =>
  [...container.querySelectorAll(".nav-tile-link .nav-tile-label")].map((n) => n.textContent.trim());
beforeEach(() => {
  currentPath = "/dashboard";
  pushCalls.length = 0;
  // happy-dom has no layout engine; the focus helpers read client rects.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 10, height: 10 }]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}), text: async () => "",
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("the URL decides the section — a header's only job is to move it", () => {
  it("opens Home on /dashboard", async () => {
    await commit();
    expect(expandedId()).toBe("home");
    expect(tileLabels()).toEqual(["Home"]);
  });
  it("a header click navigates to that section's first room, and the rooms follow", async () => {
    await commit();
    await act(async () => { sec("gateway").click(); });
    expect(pushCalls).toEqual(["/dashboard/endpoint"]);
    await commit();
    expect(expandedId()).toBe("gateway");
    expect(tileLabels()).toEqual(["Endpoint & Key", "Providers", "Combos", "Routed by Combo"]);
  });
  it("re-clicking the open section earns no duplicate history entry", async () => {
    await commit();
    currentPath = "/dashboard/endpoint";
    await commit();
    await act(async () => { sec("gateway").click(); });
    expect(pushCalls).toEqual([]);
  });
  it("every section is reachable, and Home lights again on a browser return", async () => {
    await commit();
    const walk = [
      ["gateway", "/dashboard/endpoint", "Endpoint & Key"],
      ["traffic", "/dashboard/usage", "Usage"],
      ["network", "/dashboard/proxy", "Proxy"],
      ["toolkit", "/dashboard/cli-tools", "CLI Tools"],
      ["system", "/dashboard/logs", "Request Logs"],
    ];
    for (const [id, href, firstTile] of walk) {
      await act(async () => { sec(id).click(); });
      expect(pushCalls.at(-1), `push for ${id}`).toBe(href);
      await commit();
      expect(expandedId(), `expanded after ${id}`).toBe(id);
      expect(tileLabels()[0], `first tile for ${id}`).toBe(firstTile);
    }
    // A browser navigation (back/forward, a bookmark, a typed URL) must light
    // the section the URL names — nothing in the helm may resist the route.
    currentPath = "/dashboard";
    await commit();
    expect(expandedId()).toBe("home");
    expect(tileLabels()).toEqual(["Home"]);
  });
  it("falls back to Home rather than opening nothing on an unknown route", async () => {
    currentPath = "/dashboard/nowhere";
    await commit();
    expect(expandedId()).toBe("home");
  });
  it("exactly one accordion is open at any route", async () => {
    for (const route of ["/dashboard", "/dashboard/usage", "/dashboard/proxy", "/dashboard/skills", "/dashboard/logs"]) {
      currentPath = route;
      await commit();
      const open = sections().filter((b) => b.getAttribute("aria-expanded") === "true");
      expect(open.length, route).toBe(1);
    }
  });
});
// ────────────────────────────────────────────────────────────────
// The claim set — every door, and the route a door lands on
// ────────────────────────────────────────────────────────────────
/**
 * A door that redirects must not strand its own section. System's Settings tile
 * points at `/dashboard/profile`, which `redirect()`s to `/dashboard/settings` —
 * and no room renders that target, so the helm used to light Home the instant a
 * user walked through its own door and the System rooms they were working in
 * disappeared. Found by clicking the door on a live shore; the fix is the
 * SECTION_ALIASES table, and these cases keep it honest.
 */
describe("a section claims its doors and the routes they land on", () => {
  const sectionOf = async (pathname) => {
    currentPath = pathname;
    await commit();
    return expandedId();
  };
  it("keeps System open on the redirect target of its own Settings door", async () => {
    expect(await sectionOf("/dashboard/settings")).toBe("system");
  });
  it("keeps System open on a nested route under that target", async () => {
    expect(await sectionOf("/dashboard/settings/pricing")).toBe("system");
  });
  it("claims the door's own href too, before the redirect fires", async () => {
    expect(await sectionOf("/dashboard/profile")).toBe("system");
  });
  it("assigns each section's own first room to itself", async () => {
    const walk = [
      ["/dashboard/endpoint", "gateway"],
      ["/dashboard/usage", "traffic"],
      ["/dashboard/proxy", "network"],
      ["/dashboard/skills", "toolkit"],
      ["/dashboard/logs", "system"],
      ["/dashboard", "home"],
    ];
    for (const [route, id] of walk) {
      expect(await sectionOf(route), route).toBe(id);
    }
  });
  it("never lets a broader claim shadow a more specific sibling", async () => {
    // `/dashboard/skills` must stay Toolkit even though System claims
    // `/dashboard/settings` — the longest match wins, not the first one found.
    expect(await sectionOf("/dashboard/skills")).toBe("toolkit");
    expect(await sectionOf("/dashboard/settings/pricing")).toBe("system");
  });
});
// ────────────────────────────────────────────────────────────────
// The Star's restored door — /dashboard/mitm in Network
// ────────────────────────────────────────────────────────────────
/**
 * The chart originally struck mitm from the nav. The Star restored mitm alone
 * on 2026-09-29 and the chart was amended in the same edit — so these cases
 * pin the decree, and the claim-set cases above are what guarantee the new
 * room cannot strand Network the way the Settings door once stranded System.
 */
describe("the restored mitm door", () => {
  it("sits in Network beside Proxy, in that order", async () => {
    currentPath = "/dashboard/proxy";
    await commit();
    expect(tileLabels()).toEqual(["Proxy", "MITM"]);
  });
  it("opens NETWORK when you stand in it — never Home", async () => {
    currentPath = "/dashboard/mitm";
    await commit();
    expect(expandedId()).toBe("network");
    expect(tileLabels()).toContain("MITM");
  });
  it("marks the mitm tile current, and only it", async () => {
    currentPath = "/dashboard/mitm";
    await commit();
    const marked = [...container.querySelectorAll('.nav-tile[data-active="true"]')];
    expect(marked.length).toBe(1);
    expect(marked[0].querySelector(".nav-tile-label").textContent.trim()).toBe("MITM");
    expect(marked[0].querySelector(".nav-tile-link").getAttribute("aria-current")).toBe("page");
  });
  it("carries no chip — the room has no counts-only source", async () => {
    currentPath = "/dashboard/mitm";
    await commit();
    const mitm = [...container.querySelectorAll(".nav-tile")].find(
      (t) => t.querySelector(".nav-tile-label")?.textContent.trim() === "MITM"
    );
    expect(mitm.querySelector(".nav-tile-count")).toBeNull();
  });
  it("does NOT restore the four rooms the Star left omitted", async () => {
    const labels = [];
    for (const route of ["/dashboard", "/dashboard/endpoint", "/dashboard/usage", "/dashboard/proxy", "/dashboard/skills", "/dashboard/logs"]) {
      currentPath = route;
      await commit();
      labels.push(...tileLabels());
    }
    for (const omitted of ["Basic Chat", "Pxpipe", "Proxy Pools", "Proxy Fitness", "basic-chat", "pxpipe", "proxy-pools", "proxy-fitness"]) {
      expect(labels, `${omitted} must stay out of the nav`).not.toContain(omitted);
    }
  });
});
// ────────────────────────────────────────────────────────────────
// §4.5 — "Never render 0, —, or a placeholder to fill a gap"
// ────────────────────────────────────────────────────────────────
/**
 * The sealed chart's chip law, pinned. This is the one rule of the design that
 * reads as an absolute ("NEVER render 0"), and it was broken anyway: the count
 * chips let a zero through, so the helm printed "Combos 0" beside a fleet that
 * actually held an idle combo. It was caught on a live shore, not here.
 */
describe("a tile shows a number only when the pulse carries an honest one", () => {
  const PULSE_ZERO = {
    ts: 1,
    sources: { keys: true, providers: true, combos: true, proxy: true, usage: true, errors: true },
    keys: { total: 0, attention: 0 },
    // Every field present and answered — the payload is HEALTHY, the numbers
    // are simply zero. That is the case a naive `src[x]` test lets through.
    providers: { total: 0, healthy: 0, degraded: 0, down: 0, cooling: 0, idle: 0, worst: "idle" },
    combos: { total: 1, active: 0, idle: 1 },
    proxy: { total: 0, active: 0, blocked: 0 },
    usage: { requests: 0, cost: 0 },
    errors: { count: 0 },
  };
  const PULSE_LIVE = {
    ts: 2,
    sources: { keys: true, providers: true, combos: true, proxy: true, usage: true, errors: true },
    keys: { total: 2, attention: 0 },
    providers: { total: 14, healthy: 12, degraded: 1, down: 0, cooling: 1, idle: 0, worst: "degraded" },
    combos: { total: 3, active: 1, idle: 2 },
    proxy: { total: 5, active: 4, blocked: 2 },
    usage: { requests: 900, cost: 1.25 },
    errors: { count: 7 },
  };
  const serve = async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => payload, text: async () => "",
    }));
    await commit();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };
  const tile = (label) =>
    [...container.querySelectorAll(".nav-room")].find(
      (r) => r.querySelector(".nav-tile-label")?.textContent.trim() === label
    );
  const chipText = (label) => tile(label)?.querySelector(".nav-tile-count")?.textContent ?? null;
  it("renders NO chip at zero, on every source", async () => {
    await serve(PULSE_ZERO);
    currentPath = "/dashboard/endpoint";
    await commit();
    expect(chipText("Endpoint & Key"), "keys.total = 0").toBeNull();
    expect(chipText("Combos"), "combos.active = 0 while one is merely idle").toBeNull();
    expect(chipText("Providers"), "providers.total = 0").toBeNull();
  });
  it("still renders the providers DOT at a zero total — state is real at zero", async () => {
    await serve(PULSE_ZERO);
    currentPath = "/dashboard/endpoint";
    await commit();
    const dot = tile("Providers")?.querySelector(".nav-tile-dot");
    expect(dot, "the fleet state must survive a zero count").not.toBeNull();
    expect(dot.getAttribute("data-state")).toBe("idle");
    expect(dot.getAttribute("aria-label")).toBe("Fleet state: idle");
  });
  it("renders each chip from its own field once the numbers are real", async () => {
    await serve(PULSE_LIVE);
    currentPath = "/dashboard/endpoint";
    await commit();
    expect(chipText("Endpoint & Key")).toBe("2");
    expect(chipText("Combos")).toBe("1"); // active, not total
    expect(chipText("Providers")).toBe("14");
    expect(tile("Providers").querySelector(".nav-tile-dot").getAttribute("data-state")).toBe("degraded");
  });
  it("reads each room's own source — money and errors ride their own tone", async () => {
    await serve(PULSE_LIVE);
    currentPath = "/dashboard/usage";
    await commit();
    expect(chipText("Usage")).toBe("$1.25");
    currentPath = "/dashboard/proxy";
    await commit();
    expect(chipText("Proxy")).toBe("5 · 2"); // total, with the blocked count appended
    currentPath = "/dashboard/logs";
    await commit();
    expect(chipText("Request Logs")).toBe("7");
  });
});
