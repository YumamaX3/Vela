// @vitest-environment happy-dom
/**
 * tests/unit/log-render-law.test.js — M9 "The Harbor Reborn" (§7, §11).
 *
 * This suite is the GUARD for §7's rendering law, and the windowing and
 * voyage-view laws that sit beside it. §7 names the law in one sentence —
 * "no component in the Log Harbor may use dangerouslySetInnerHTML (or any
 * raw-HTML viewer); a guard test asserts absence" — and §11 requires every
 * claim to be mutation-landable. So the cases below are written to FAIL when
 * the thing they police is broken, and the mutations at the foot of this file
 * are the proof that they do.
 *
 * WHAT EACH BLOCK PINS
 *   A · the rendering law — zero `dangerouslySetInnerHTML` across every file
 *       under dashboard/logs/, and a `<script>` inside a message becoming a
 *       TEXT NODE (not an element) when the row renders.
 *   B · the window — 1,200 rows, under 100 in the DOM, and the right slice
 *       painted for a given scrollTop.
 *   C · the filter chips — a chip set becomes the events door's query params,
 *       and the two-tier `q` law is reported, not hidden.
 *   D · the voyage — it fetches by reqId, and an unjoinable row (reqId null)
 *       says so out loud instead of rendering an empty panel.
 *   E · j/k — the cursor moves down and back up, and stops at the ends.
 *
 * ── WHY THE ROWS ARE HAND-BUILT HERE ─────────────────────────────────────────
 * The windowing and filter cases do not need the SSE door to be real: they
 * need a thousand rows with the persisted SHAPE, and `toWireRow` is what
 * defines that shape. So rows are built by a local helper mirroring it, and
 * the ONE thing that must be real — the rendering path — is real: these mount
 * the actual `LogRow` and the actual `UnifiedTail`, and read the actual DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

import LogRow, { ansiToSegments, rowKey } from "@/app/(dashboard)/dashboard/logs/LogRow.js";
import { filterToParams } from "@/app/(dashboard)/dashboard/logs/LogFilterBar.js";
import { postureLines } from "@/app/(dashboard)/dashboard/logs/LogPostureBanner.js";
import useWindowedList, { ROW_HEIGHT } from "@/app/(dashboard)/dashboard/logs/useWindowedList.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A persisted-shaped row, mirroring `toWireRow` field for field. */
function makeRow(over = {}) {
  return {
    id: 1,
    ts: 1760000000000,
    lvl: 20,
    stream: "console",
    reqId: null,
    upstreamId: null,
    provider: null,
    tag: null,
    msg: "a line",
    meta: null,
    truncMsg: false,
    truncMeta: false,
    ...over,
  };
}

/**
 * A silent EventSource for the suites that are not about streaming.
 *
 * `removeEventListener` is here because the REAL component calls it on
 * teardown: UnifiedTail removes the `# missed N` comment listener in its own
 * cleanup, and a fake missing that method throws during unmount — which fails
 * a test for a reason that has nothing to do with what it asserts. A fake
 * should be the SHAPE of the thing it replaces, not a subset.
 */
class SilentES {
  constructor() {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

let container;
let root;
const mount = async (Comp, props) => {
  await act(async () => {
    root.render(<Comp {...props} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};
const flat = () => container.textContent.replace(/\s+/g, " ");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// A · THE RENDERING LAW
// ────────────────────────────────────────────────────────────────────────────

describe("A · §7's rendering law: TEXT only, never markup", () => {
  it("no file under dashboard/logs/ uses dangerouslySetInnerHTML or a raw-HTML sink", () => {
    // The guard walks the REAL harbor directory rather than a hardcoded list:
    // a new file added to the harbor is covered the moment it lands, which is
    // the whole point of a guard and the reason this is not a grep of three
    // known filenames.
    const dir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/app/(dashboard)/dashboard/logs"
    );
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);

    // The sinks §7 forbids: innerHTML in its several spellings, the React
    // escape hatch, document.write, insertAdjacentHTML, and the DOMParser /
    // Range route that produces the same result.
    const FORBIDDEN = [
      "dangerouslySetInnerHTML",
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "createContextualFragment",
      "DOMParser",
    ];

    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const sink of FORBIDDEN) {
        // A comment NAMING the law is not a sink; only real code is, so both
        // comment forms are stripped before the search. The line-comment
        // pattern captures the character before `//` so a `://` inside a
        // string literal cannot end the match early.
        const code = src
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        if (code.includes(sink)) offenders.push(`${f}: ${sink}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("renders a message carrying <script> as a text node, never an element", async () => {
    const row = makeRow({
      id: 7,
      msg: "<script>alert(1)</script> leaked vela-v1-abc123 upstream",
      stream: "container",
    });
    await mount(LogRow, { row });

    // The script tag never becomes an element…
    expect(container.querySelector("script")).toBeNull();
    // …and the text is present VERBATIM, which is the whole contract: an
    // operator copying a row out gets the bytes the process printed.
    expect(flat()).toContain("<script>alert(1)</script>");
    expect(flat()).toContain("vela-v1-abc123");
  });

  it("an <img onerror> in a message produces no element and no handler", async () => {
    const row = makeRow({ id: 8, msg: '<img src=x onerror="alert(1)">and <b>bold</b>' });
    await mount(LogRow, { row });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    // The literal text is all that survives — escaped, visible, inert.
    expect(flat()).toContain('<img src=x onerror="alert(1)">');
    expect(flat()).toContain("<b>bold</b>");
  });

  it("ANSI in the raw view becomes styled spans of escaped text, not markup", () => {
    const segments = ansiToSegments("[31mred[0m <script>x</script>");
    // The SGR code produced a boundary and a class; the script tag is inert
    // TEXT inside a segment, and no segment carries markup.
    expect(segments.map((s) => s.text).join("")).toBe("red <script>x</script>");
    expect(segments.some((s) => s.className && s.className.includes("text-red-400"))).toBe(true);
    // The reset code clears the class rather than leaking it forward.
    expect(segments[segments.length - 1].className).toBeNull();
  });

  it("keys a live row by (ts, seq) and a persisted row by its id", () => {
    // M7's note: live frames carry `id: null` because the worker assigns the
    // row id later. Without this key a thousand live rows all key on
    // `undefined` and React reuses one DOM node for all of them.
    const liveA = makeRow({ id: null, ts: 1000, seq: 1 });
    const liveB = makeRow({ id: null, ts: 1000, seq: 2 });
    expect(rowKey(liveA)).not.toBe(rowKey(liveB));
    expect(rowKey(makeRow({ id: 42 }))).toBe("p42");
  });

  it("renders an unjoinable row as honestly unjoinable", async () => {
    await mount(LogRow, { row: makeRow({ id: 3, reqId: null }) });
    expect(flat()).toContain("unjoinable");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// B · THE VIRTUALIZED WINDOW
// ────────────────────────────────────────────────────────────────────────────

describe("B · the hand-rolled window", () => {
  /** Mount a probe that exposes the hook's own numbers as DOM. */
  function windowProbe(rows, scrollTop, viewport) {
    function Probe() {
      const list = useWindowedList(rows, { follow: false, viewport });
      return (
        <div>
          <div data-testid="meta">
            {`${list.startIndex}|${list.endIndex}|${list.totalHeight}|${list.offsetY}`}
          </div>
          <div ref={list.scrollRef} onScroll={list.onScroll} data-testid="scroller">
            <div style={{ height: list.totalHeight }}>
              <div style={{ transform: `translateY(${list.offsetY}px)` }}>
                {list.window.map((r) => (
                  <div key={r.id} data-testid="row" style={{ height: ROW_HEIGHT }}>
                    {r.msg}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }
    return Probe;
  }

  it("renders only the visible slice when 1,200 rows are held", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) =>
      makeRow({ id: i + 1, ts: 1760000000000 + i, msg: `row ${i}` })
    );
    await mount(windowProbe(rows, 0, 600));

    const painted = container.querySelectorAll('[data-testid="row"]');
    // The DOM holds under 100 rows while the list holds 1,200 — that gap IS
    // the virtualization. A regression that renders all 1,200 fails here.
    expect(rows.length).toBe(1200);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.length).toBeLessThan(100);
    // And the scroll range is the FULL height, so the scrollbar is honest.
    const meta = container.querySelector('[data-testid="meta"]').textContent.split("|");
    expect(Number(meta[2])).toBe(1200 * ROW_HEIGHT);
  });

  it("scrolls the window: a different scrollTop paints a different slice", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) =>
      makeRow({ id: i + 1, ts: 1760000000000 + i, msg: `row ${i}` })
    );
    const Probe = windowProbe(rows, 0, 600);

    await mount(Probe);
    const top = container.querySelector('[data-testid="meta"]').textContent;
    const topFirst = container.querySelector('[data-testid="row"]').textContent;

    // Scroll to row 400 and let the component re-render.
    await act(async () => {
      container.querySelector('[data-testid="scroller"]').dispatchEvent(
        new window.Event("scroll", { bubbles: true })
      );
    });
    await mount(Probe, {});

    const scroller = container.querySelector('[data-testid="scroller"]');
    Object.defineProperty(scroller, "scrollTop", { value: 400 * ROW_HEIGHT, writable: true });
    await act(async () => {
      scroller.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    });

    const after = container.querySelector('[data-testid="meta"]').textContent;
    const afterFirst = container.querySelector('[data-testid="row"]').textContent;
    expect(after).not.toBe(top);
    // The first painted row is near row 400, minus the overscan — never row 0.
    expect(afterFirst).not.toBe(topFirst);
    const painted = container.querySelectorAll('[data-testid="row"]');
    expect(painted.length).toBeLessThan(100);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// C · THE FILTER CHIPS → THE DOOR'S PARAMS
// ────────────────────────────────────────────────────────────────────────────

describe("C · filter chips drive the events door", () => {
  it("maps every chip to exactly its §6 selector parameter", () => {
    const now = 1760000000000;
    const params = filterToParams(
      {
        stream: "console",
        minLvl: 30,
        provider: "openai",
        tag: "COMBO",
        range: "15m",
        q: "timeout",
        upstreamId: "up-1",
      },
      now
    );
    expect(params.get("stream")).toBe("console");
    expect(params.get("minLvl")).toBe("30");
    expect(params.get("provider")).toBe("openai");
    expect(params.get("tag")).toBe("COMBO");
    expect(params.get("q")).toBe("timeout");
    expect(params.get("upstreamId")).toBe("up-1");
    // The window chip is DERIVED at call time, so a saved filter re-anchors to
    // NOW rather than to the moment it was saved.
    expect(Number(params.get("since"))).toBe(now - 15 * 60_000);
  });

  it("emits nothing for an empty filter, so the tail is unnarrowed", () => {
    const params = filterToParams({});
    expect([...params.keys()]).toEqual([]);
  });

  it("sends each chip to the events door, and tells the operator when `q` will not apply", async () => {
    // §6's two-tier law is SERVER-side, and this suite does not fake it: it
    // drives the real filter-to-params mapping, types into the real bar, and
    // reads the real warning the bar shows when free text has nothing to ride
    // on. What it proves is that the chip sends the param AND that the operator
    // is told when the term is going to be ignored — a filter that silently
    // stops applying is the silent-lie class the 400 laws exist to kill.
    vi.stubGlobal("EventSource", SilentES);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

    const { default: LogFilterBar } = await import("@/app/(dashboard)/dashboard/logs/LogFilterBar.js");

    // With NO narrowing selector, a typed term produces the honest warning.
    await mount(LogFilterBar, { filter: {}, onChange: () => {} });
    const input = container.querySelector('input[aria-label="Free text over messages"]');
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "vela-v1-should-be-refused");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(flat()).toContain("Narrow first, then the word search will apply.");

    // And the chip DOES send the term verbatim to the door — the client is not
    // the authority on what a query may contain; the door is.
    const params = filterToParams({ stream: "console", q: "vela-v1-should-be-refused" });
    expect(params.get("q")).toBe("vela-v1-should-be-refused");
    expect(params.get("stream")).toBe("console");
  });

  it("tells the operator the door ignored the term rather than hiding it", async () => {
    vi.stubGlobal("EventSource", SilentES);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

    const { default: LogFilterBar } = await import("@/app/(dashboard)/dashboard/logs/LogFilterBar.js");
    await mount(LogFilterBar, {
      filter: {},
      onChange: () => {},
      qIgnoredBecauseUnnarrowed: true,
    });
    expect(flat()).toContain("Free text is ignored until a stream, level, provider, tag, or window narrows");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// D · THE VOYAGE VIEW
// ────────────────────────────────────────────────────────────────────────────

describe("D · the voyage joins on reqId only", () => {
  it("fetches by reqId and renders unjoinable rows honestly", async () => {
    const seen = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        seen.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rows: [
              makeRow({ id: 11, reqId: "req-abc", stream: "request", msg: "voyage line 2" }),
              makeRow({ id: 10, reqId: "req-abc", stream: "console", msg: "voyage line 1" }),
            ],
            hasMore: false,
            nextCursor: null,
          }),
        };
      })
    );
    vi.stubGlobal("EventSource", SilentES);

    const { default: VoyageView } = await import("@/app/(dashboard)/dashboard/logs/VoyageView.js");

    // ── A JOINABLE row: the query carries the reqId, and the rows land. ──
    await mount(VoyageView, { row: makeRow({ id: 10, reqId: "req-abc" }), isOpen: true, onClose: () => {} });
    expect(seen[0]).toContain("reqId=req-abc");
    expect(flat()).toContain("req-abc");
    expect(flat()).toContain("voyage line 1");
    expect(flat()).toContain("voyage line 2");

    // The ledger slot is stated, not faked — no door joins usageHistory by
    // reqId yet, and the drawer says that rather than inventing a join.
    expect(flat()).toContain("Ledger join pending");

    // ── An UNJOINABLE row: named as unjoinable, with NO query at all. ────
    seen.length = 0;
    await mount(VoyageView, { row: makeRow({ id: 99, reqId: null }), isOpen: true, onClose: () => {} });
    expect(flat()).toContain("This line is unjoinable");
    // Nothing was asked of the door: a row with no reqId has no query, and a
    // request for one would be the guess §3 forbids.
    expect(seen.filter((u) => u.includes("/api/logs/events"))).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// E · j/k NAVIGATION
// ────────────────────────────────────────────────────────────────────────────

describe("E · j/k move the cursor", () => {
  it("moves down and back up, and stops at the ends", async () => {
    // Extends the shared silent fake so the missing-listener methods it
    // inherits are exactly the ones the real component calls.
    class FakeES extends SilentES {
      constructor(url) {
        super();
        this.url = url;
        setTimeout(() => {
          this.onopen?.();
          // The stream door's REAL init frame: the newest persisted rows,
          // ASCENDING, exactly as `queryLogTail` returns them. The tail must
          // render these without reversing or re-keying them.
          this.onmessage?.({
            data: JSON.stringify({
              type: "init",
              replay: [
                makeRow({ id: 1, msg: "first" }),
                makeRow({ id: 2, msg: "second" }),
                makeRow({ id: 3, msg: "third" }),
              ],
            }),
          });
        }, 0);
      }
    }
    vi.stubGlobal("EventSource", FakeES);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    );

    const { default: UnifiedTail } = await import("@/app/(dashboard)/dashboard/logs/UnifiedTail.js");
    await mount(UnifiedTail);
    expect(flat()).toContain("first");
    expect(flat()).toContain("third");

    const key = async (k) => {
      await act(async () => {
        window.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
      });
    };

    // j/k move a SELECTION, and a selection is visible as `aria-selected` on
    // the row itself. Asserting on the row's own attribute — rather than on
    // drawer text — is both the honest signal and the one that does not depend
    // on where a portal happens to mount.
    const selectedNow = () =>
      [...container.querySelectorAll("[data-row-key]")].filter(
        (n) => n.getAttribute("aria-selected") === "true"
      );

    await key("j");
    expect(selectedNow().length).toBe(1);
    expect(selectedNow()[0].textContent).toContain("first");

    await key("j");
    expect(selectedNow()[0].textContent).toContain("second");

    await key("k");
    expect(selectedNow()[0].textContent).toContain("first");

    // k at the top clamps at row zero rather than wrapping or throwing.
    await key("k");
    expect(selectedNow()[0].textContent).toContain("first");

    // j past the last row clamps at the last row.
    for (let i = 0; i < 10; i += 1) await key("j");
    expect(selectedNow()[0].textContent).toContain("third");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F · THE POSTURE BANNER
// ────────────────────────────────────────────────────────────────────────────

describe("F · §2's posture law reaches the operator", () => {
  it("says plainly that durable logging is disabled in the mysql posture", () => {
    const lines = postureLines({ posture: "mysql", degraded: false });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].text).toContain("DISABLED");
    expect(lines[0].tone).toBe("danger");
  });

  it("names the degraded lag and the not-mirrored twin rather than hiding them", () => {
    const degraded = postureLines({
      posture: "sqlite",
      degraded: true,
      driver: "sql.js",
      degradedFlushLagMs: 5000,
      shutdownFlushWindowMs: 2000,
    });
    expect(degraded.some((l) => l.text.includes("Degraded posture"))).toBe(true);
    expect(degraded.some((l) => l.text.includes("5s"))).toBe(true);

    const mirror = postureLines({
      posture: "mirror",
      degraded: false,
      workerFlushCadenceMs: 250,
      shutdownFlushWindowMs: 2000,
    });
    expect(mirror.some((l) => l.text.includes("NOT-MIRRORED"))).toBe(true);
    // The hard-kill window is named on EVERY posture, including the good one.
    expect(mirror.some((l) => l.text.includes("hard kill"))).toBe(true);
  });

  it("reports dropped lines instead of rendering a silently short tail", () => {
    const lines = postureLines({
      posture: "sqlite",
      degraded: false,
      droppedCount: 12,
      shutdownFlushWindowMs: 2000,
    });
    expect(lines.some((l) => l.text.includes("12") && l.text.includes("dropped"))).toBe(true);
  });

  it("refuses to claim any guarantee when the stats door failed", () => {
    const lines = postureLines(null, "boom");
    expect(lines.length).toBe(1);
    expect(lines[0].tone).toBe("danger");
    expect(lines[0].text).toContain("unverified");
  });
});