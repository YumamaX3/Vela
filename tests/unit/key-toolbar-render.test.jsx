// @vitest-environment happy-dom
/**
 * The keys room's toolbar - the five controls an operator uses to choose which
 * keys are in view, in what order, and in which shape (2026-09-29).
 *
 * WHY THIS SUITE EXISTS: the row was mended for geometry, but the load-bearing
 * half of that fix is not visual. Two of the five controls are icon-only buttons
 * that carried a `title` and NO `aria-label`, so each one's accessible name was
 * its Material Symbols ligature text - a screen reader announced "check" and
 * "arrow_downward", the one part of a glyph a user should never hear. Nothing in
 * the house could see it: the build compiles an icon-only button happily and no
 * test had ever rendered this row.
 *
 * So this suite renders the toolbar as the room does and asserts what a user
 * actually gets hold of - the name of every icon-only control, which control
 * carries which act, and that each act dispatches. It guards the seam, not the
 * styling: a height or a colour token is proved in the browser, not pinned here.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The room runs these through the i18n runtime; the assertions below read the
// English source strings, so the identity translation is the honest stand-in.
vi.mock("@/i18n/runtime", () => ({ translate: (s) => s }));

import KeyToolbar from "@/app/(dashboard)/dashboard/endpoint/components/keys/KeyToolbar";

const mounted = [];

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  const entry = { container, root };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** A deck shaped the way `useKeyDeck` hands one over, every act a spy. */
function makeDeck(overrides = {}) {
  const keys = overrides.visibleKeys ?? [{ id: "a" }, { id: "b" }];
  const deck = {
    query: "",
    setQuery: vi.fn(),
    posture: null,
    setPosture: vi.fn(),
    sortKey: "created",
    setSortKey: vi.fn(),
    sortDir: "asc",
    setSortDir: vi.fn(),
    lens: "cards",
    setLens: vi.fn(),
    visibleKeys: keys,
    selected: new Set(),
    selectAllVisible: vi.fn(),
    clearSelection: vi.fn(),
  };
  return { ...deck, ...overrides, visibleKeys: keys };
}

/** Every control that carries its own accessible name. */
function labelledButtons(container) {
  return [...container.querySelectorAll("button[aria-label]")];
}

describe("KeyToolbar", () => {
  it("gives both icon-only controls a spoken name instead of a ligature word", () => {
    const { container } = render(<KeyToolbar deck={makeDeck()} />);
    const labels = labelledButtons(container).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Select every key currently visible");
    expect(labels).toContain("Ascending");
    // The mechanism, not a coincidence: each of these controls is icon-only by
    // structure (no text node of its own), and every glyph it draws is blinded -
    // so the name can only come from the attribute above.
    for (const button of labelledButtons(container)) {
      const text = [...button.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.nodeValue.trim())
        .join("");
      expect(text).toBe("");
      const glyphs = [...button.querySelectorAll(".material-symbols-outlined")];
      expect(glyphs.length).toBeGreaterThan(0);
      for (const glyph of glyphs) expect(glyph.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("flips the ordering direction and renames itself to match", () => {
    const deck = makeDeck({ sortDir: "asc" });
    const { container } = render(<KeyToolbar deck={deck} />);
    const button = labelledButtons(container).find(
      (b) => b.getAttribute("aria-label") === "Ascending",
    );
    act(() => button.click());
    expect(deck.setSortDir).toHaveBeenCalledWith("desc");
  });

  it("names the descending side when the order runs downward", () => {
    const { container } = render(<KeyToolbar deck={makeDeck({ sortDir: "desc" })} />);
    const labels = labelledButtons(container).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Descending");
    expect(labels).not.toContain("Ascending");
  });

  it("orders through the shared field, offering every column and a named placeholder", () => {
    const deck = makeDeck();
    const { container } = render(<KeyToolbar deck={deck} />);
    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    const options = [...select.options].map((o) => o.textContent.trim());
    expect(options).toEqual(["Sort by", "Created", "Last used", "Requests", "Tokens", "Spend", "Name"]);
    expect(select.value).toBe("created");
    act(() => {
      select.value = "cost";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(deck.setSortKey).toHaveBeenCalledWith("cost");
  });

  it("selects every visible key, then offers to clear the selection", () => {
    const fresh = makeDeck();
    const first = render(<KeyToolbar deck={fresh} />);
    const selectAll = labelledButtons(first.container).find(
      (b) => b.getAttribute("aria-label") === "Select every key currently visible",
    );
    act(() => selectAll.click());
    expect(fresh.selectAllVisible).toHaveBeenCalledTimes(1);
    expect(fresh.clearSelection).not.toHaveBeenCalled();

    const held = makeDeck({ selected: new Set(["a", "b"]) });
    const second = render(<KeyToolbar deck={held} />);
    const clear = labelledButtons(second.container).find(
      (b) => b.getAttribute("aria-label") === "Clear the selection",
    );
    act(() => clear.click());
    expect(held.clearSelection).toHaveBeenCalledTimes(1);
    expect(held.selectAllVisible).not.toHaveBeenCalled();
  });

  it("withholds select-all while no key is in view, and only part of a selection counts as all", () => {
    const empty = render(<KeyToolbar deck={makeDeck({ visibleKeys: [] })} />);
    const button = labelledButtons(empty.container).find(
      (b) => b.getAttribute("aria-label") === "Select every key currently visible",
    );
    expect(button.disabled).toBe(true);

    // Two visible, one selected: the act on offer is still "select all", never
    // "clear" - clearing a partial selection would drop the key already chosen.
    const partial = render(<KeyToolbar deck={makeDeck({ selected: new Set(["a"]) })} />);
    const labels = labelledButtons(partial.container).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Select every key currently visible");
    expect(labels).not.toContain("Clear the selection");
  });

  it("keeps the lens control one group of two with exactly one pressed", () => {
    const deck = makeDeck({ lens: "table" });
    const { container } = render(<KeyToolbar deck={deck} />);
    const group = container.querySelector('[role="group"]');
    expect(group.getAttribute("aria-label")).toBe("View");
    const pressed = [...group.querySelectorAll("button")].map((b) => ({
      label: [...b.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.nodeValue.trim())
        .join(""),
      glyphHidden: b.querySelector(".material-symbols-outlined").getAttribute("aria-hidden"),
      pressed: b.getAttribute("aria-pressed"),
    }));
    expect(pressed).toEqual([
      { label: "Cards", glyphHidden: "true", pressed: "false" },
      { label: "Table", glyphHidden: "true", pressed: "true" },
    ]);
    act(() => [...group.querySelectorAll("button")][0].click());
    expect(deck.setLens).toHaveBeenCalledWith("cards");
  });

  it("names the live filter only while one is on, and clears it when struck", () => {
    const off = render(<KeyToolbar deck={makeDeck()} />);
    expect(labelledButtons(off.container).map((b) => b.getAttribute("aria-label"))).not.toContain(
      "Clear the posture filter",
    );

    const deck = makeDeck({ posture: "expiring" });
    const on = render(<KeyToolbar deck={deck} />);
    const clear = labelledButtons(on.container).find(
      (b) => b.getAttribute("aria-label") === "Clear the posture filter",
    );
    expect(clear).toBeTruthy();
    act(() => clear.click());
    expect(deck.setPosture).toHaveBeenCalledWith(null);
  });
});
