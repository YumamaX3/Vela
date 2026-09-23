// @vitest-environment happy-dom
/**
 * The endpoint room's two smallest seams — the bulk bar's per-item verdicts and
 * the lens switch's accessibility contract (v0.9.91).
 *
 * WHY THIS SUITE EXISTS: two mends in this release were made in components that
 * NO test had ever rendered, which is the exact shape this repo has now been
 * bitten by four times (a name declared and never resolvable; a prop renamed in
 * the signature and left in the body; a reserved name reused). Both mends here
 * are runtime-only contracts — a screen-reader role and a rendered refusal
 * list — so `npm run build` compiles them either way and only a render sees
 * them.
 *
 *   · BulkActionBar: the route has ALWAYS answered one verdict PER KEY
 *     (`{ results: [{ name, ok, error }] }`), but the bar collapsed them to a
 *     summary string, so an operator running a 40-key pause learned "38 applied,
 *     2 refused" and could never learn WHICH two, or why. The bar now renders
 *     every refusal by name. This suite asserts the words an operator reads.
 *
 *   · SegmentedControl: a bare div of <button>s with no role and no pressed
 *     state, so a screen reader announced identical buttons and no active view.
 *     It now carries role="group" + aria-label and aria-pressed per option.
 *
 * The suite is deliberately narrow: it guards the seam, not the styling, the
 * ordering, or the room.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
// The room runs these through the i18n runtime; the assertions below read the
// English source strings, so the identity translation is the honest stand-in.
vi.mock("@/i18n/runtime", () => ({ translate: (s) => s }));
import BulkActionBar from "@/app/(dashboard)/dashboard/endpoint/components/keys/BulkActionBar";
import SegmentedControl from "@/shared/components/SegmentedControl";

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

/** A deck stand-in carrying only what the bar reads. `bulkVerdicts` is the
 * last run's per-item list, exactly as the deck stores it. */
function deckWith(bulkVerdicts) {
  return {
    selected: new Set([1, 2]),
    clearSelection: () => {},
    setActive: () => {},
    revoke: () => {},
    setCategory: () => {},
    openImport: () => {},
    exportFleet: () => {},
    busy: false,
    bulkVerdicts,
    clearBulkVerdicts: () => {},
  };
}

describe("BulkActionBar — the per-item verdicts", () => {
  it("names every refusal, with its reason, after a partial bulk run", () => {
    const { container } = render(
      <BulkActionBar
        deck={deckWith([
          { name: "alpha", ok: true },
          { name: "beta", ok: false, error: "quota exhausted" },
        ])}
      />
    );
    const text = container.textContent;
    // The count is stated honestly: one applied, one refused.
    expect(text).toContain("1 applied");
    expect(text).toContain("1 refused");
    // And the refusal is NAMED, with its reason — the whole point of the mend.
    expect(text).toContain("beta");
    expect(text).toContain("quota exhausted");
  });

  it("shows only the applied count when every key succeeded", () => {
    const { container } = render(
      <BulkActionBar deck={deckWith([{ name: "alpha", ok: true }, { name: "beta", ok: true }])} />
    );
    const text = container.textContent;
    expect(text).toContain("2 applied");
    expect(text).not.toContain("refused");
  });

  it("renders no verdict panel before any bulk run (bulkVerdicts null)", () => {
    const { container } = render(<BulkActionBar deck={deckWith(null)} />);
    const text = container.textContent;
    expect(text).not.toContain("applied");
    expect(text).not.toContain("refused");
  });

  it("renders nothing at all with an empty selection", () => {
    const deck = deckWith(null);
    deck.selected = new Set();
    const { container } = render(<BulkActionBar deck={deck} />);
    expect(container.textContent).toBe("");
  });
});

describe("SegmentedControl — the accessibility contract", () => {
  const OPTIONS = [
    { value: "cards", label: "Cards" },
    { value: "table", label: "Table" },
  ];

  it("exposes a labelled group and a pressed state on each option", () => {
    const { container } = render(
      <SegmentedControl options={OPTIONS} value="cards" onChange={() => {}} ariaLabel="View" />
    );
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group.getAttribute("aria-label")).toBe("View");

    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    // The active option is pressed; the other is not.
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps role='group' even when no label is given", () => {
    const { container } = render(
      <SegmentedControl options={OPTIONS} value="table" onChange={() => {}} />
    );
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    const buttons = [...container.querySelectorAll("button")];
    // The pressed state follows `value`, not position.
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("carries type='button' so it can never submit a surrounding form", () => {
    const { container } = render(
      <SegmentedControl options={OPTIONS} value="cards" onChange={() => {}} />
    );
    for (const b of container.querySelectorAll("button")) {
      expect(b.getAttribute("type")).toBe("button");
    }
  });
});
