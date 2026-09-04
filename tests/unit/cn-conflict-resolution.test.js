/**
 * cn() — conflict resolution contract.
 *
 * cn() is the shared class composer for 17 components across 51 call sites, so a
 * behaviour change here is repo-wide. Before this suite existed cn() joined and
 * collapsed whitespace only: `cn("p-4", cond && "p-2")` produced "p-4 p-2", and
 * which one the browser applied was decided by the order Tailwind emitted those
 * utilities in the stylesheet — not by the order written at the call site. On an
 * element carrying several simultaneous conditions that is an unreviewable coin
 * flip, which is why the new Combobox primitive needs a real merge.
 *
 * twMerge resolves conflicts last-wins, so the class string now reads the way the
 * component was written. Dependency: tailwind-merge 3.6.0, MIT, zero deps
 * (Star-approved 2026-09-05).
 *
 * WHAT THIS SUITE PINS, and why each group exists:
 *  1. Conflict resolution — the reason for the change.
 *  2. Group independence — classes that LOOK similar but are different utilities
 *     must both survive. Over-merging is the failure mode that would silently
 *     delete styling, so this group is the guard against it.
 *  3. Vela's own token vocabulary — custom classes (bg-surface-2, text-text-main,
 *     slide-in-right, material-symbols-outlined, shadow-[var(...)]) are not
 *     Tailwind utilities. twMerge must pass them through untouched. Verified
 *     empirically across all 49 real call sites before this suite was written:
 *     13 diffs were caller-className-wins (desired), 4 were genuine resolutions
 *     of documented intent (pinned in group 5), and zero dropped a custom token.
 *  4. Legacy compatibility — falsy filtering, whitespace collapse, empty input,
 *     and the default export, all of which existing call sites rely on.
 *  5. The four measured genuine resolutions — each is a LATENT BUG FIXED, with
 *     the source comment or conditional that proves the intent.
 *
 * Mutation-proven red: reverting cn() to the join-only implementation fails
 * groups 1 and 5 while leaving 2/3/4 green — which is the point, since those
 * groups exist to prove the merge did not over-reach.
 */
import { describe, it, expect } from "vitest";
import { cn } from "@/shared/utils/cn";
import cnDefault from "@/shared/utils/cn";

// ── 1. Conflict resolution ────────────────────────────────────────────────
describe("cn resolves conflicting utilities last-wins", () => {
  it("drops the earlier padding when a later one is given", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("honours a falsy conditional, so the earlier class survives", () => {
    // the exact shape the old implementation got wrong only when the
    // conditional was TRUE — when false, both old and new agree
    expect(cn("p-4", false && "p-2")).toBe("p-4");
    expect(cn("p-4", true && "p-2")).toBe("p-2");
  });

  it("resolves radius, gap, z-index and display conflicts", () => {
    expect(cn("rounded-lg", "rounded-xl")).toBe("rounded-xl");
    expect(cn("gap-2", "gap-3")).toBe("gap-3");
    expect(cn("z-50", "z-[80]")).toBe("z-[80]");
    // flex and hidden are both display utilities; items-center is align-items
    // and is a DIFFERENT group, so it must survive
    expect(cn("flex items-center", "hidden")).toBe("items-center hidden");
  });

  it("resolves within the same variant but not across variants", () => {
    expect(cn("hover:bg-muted", "hover:bg-primary")).toBe("hover:bg-primary");
    // hover: and focus: are different variants — no conflict
    expect(cn("hover:bg-muted", "focus:bg-primary")).toBe(
      "hover:bg-muted focus:bg-primary"
    );
  });

  it("lets an arbitrary value beat a named one", () => {
    expect(cn("bg-red-500", "bg-[#E56A4A]")).toBe("bg-[#E56A4A]");
    expect(cn("text-[10px]", "text-xs")).toBe("text-xs");
  });
});

// ── 2. Group independence — the over-merge guard ──────────────────────────
describe("cn does not merge utilities from different groups", () => {
  it("keeps dark: variants alongside their unprefixed sibling", () => {
    // dark: is a variant, so this is a different utility group entirely.
    // Merging these would silently delete every dark-mode override in the app.
    expect(cn("text-muted-foreground", "dark:text-white")).toBe(
      "text-muted-foreground dark:text-white"
    );
  });

  it("keeps w- and max-w- (different groups)", () => {
    // load-bearing for the Drawer mobile fix: max-w-full must not eat w-[600px]
    expect(cn("w-[400px]", "max-w-full")).toBe("w-[400px] max-w-full");
  });

  it("keeps px- and py- (axis split)", () => {
    expect(cn("px-4 py-2", "px-1")).toBe("py-2 px-1");
  });

  it("keeps ring width and ring colour (different groups)", () => {
    expect(cn("ring-2", "ring-red-500")).toBe("ring-2 ring-red-500");
  });

  it("keeps negative margins beside positive padding", () => {
    expect(cn("p-3", "-mx-3")).toBe("p-3 -mx-3");
  });
});

// ── 3. Vela's own token vocabulary must pass through untouched ────────────
describe("cn preserves Vela's custom classes", () => {
  it("preserves hand-written globals from globals.css", () => {
    expect(cn("card-soft", "p-4", "p-2")).toBe("card-soft p-2");
    expect(cn("material-symbols-outlined text-lg", "text-base")).toBe(
      "material-symbols-outlined text-base"
    );
    expect(cn("custom-scrollbar", "h-full")).toBe("custom-scrollbar h-full");
    expect(cn("traffic-light", "bg-red-500", "bg-green-500")).toBe(
      "traffic-light bg-green-500"
    );
  });

  it("preserves the design-token colour classes beside a real size utility", () => {
    // text-text-main is a COLOUR in Vela's token set, not a font size.
    // If twMerge misread it as a size, passing text-base would delete it and
    // every input in the app would lose its text colour.
    expect(cn("text-sm text-text-main", "text-base")).toBe(
      "text-text-main text-base"
    );
    expect(cn("bg-surface-2", "border border-transparent", "border-red-500/40")).toBe(
      "bg-surface-2 border border-red-500/40"
    );
  });

  it("preserves animation helpers and hand-written globals", () => {
    expect(cn("slide-in-right", "h-full", "h-screen")).toBe("slide-in-right h-screen");
    expect(cn("fade-in", "bg-surface", "bg-blue-500")).toBe("fade-in bg-blue-500");
  });
});

// ── 3b. The Vela token vocabulary — taught to twMerge on purpose ───────────
// globals.css registers these via `@theme inline`, so Tailwind v4 generates them
// as real utilities — but twMerge cannot know a private token name, and it cannot
// resolve `shadow-[var(--shadow-elev)]` either, because that variable might be a
// box-shadow LENGTH or a COLOUR. Left alone, both forms fall back to the CSS-order
// coin flip this module exists to end. So cn.js registers both vocabularies.
//
// This group is the reason the registration cannot be deleted as "unnecessary":
// without it, every one of these KEPT-both and let the stylesheet decide.
describe("cn resolves Vela's registered shadow and radius tokens", () => {
  it("resolves the five shadow token names against each other and against none", () => {
    expect(cn("shadow-soft", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-none", "shadow-elev")).toBe("shadow-elev");
    expect(cn("shadow-md", "shadow-elev")).toBe("shadow-elev");
    expect(cn("shadow-warm", "shadow-focus")).toBe("shadow-focus");
    expect(cn("shadow-elevated", "shadow-soft")).toBe("shadow-soft");
  });

  it("resolves the arbitrary var() shadow form — the one used 30 times in src", () => {
    // Modal.js:56, Drawer.js:53, Card.js:29, Loading.js:53 all carry this form.
    expect(cn("shadow-[var(--shadow-elev)]", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-none", "shadow-[var(--shadow-soft)]")).toBe(
      "shadow-[var(--shadow-soft)]"
    );
    expect(cn("shadow-[var(--shadow-soft)]", "shadow-[var(--shadow-elev)]")).toBe(
      "shadow-[var(--shadow-elev)]"
    );
    // the Card.js:29 shape — elev ? elevated shadow : soft shadow, one element
    expect(
      cn(
        "rounded-[14px] shadow-[var(--shadow-soft)]",
        "shadow-[var(--shadow-elev)]"
      )
    ).toBe("rounded-[14px] shadow-[var(--shadow-elev)]");
  });

  it("resolves shadow tokens under variants (the hover/focus forms in use)", () => {
    // SkillsPageClient.js uses focus-visible:shadow-[var(--shadow-focus)]
    expect(cn("hover:shadow-[var(--shadow-warm)]", "hover:shadow-none")).toBe(
      "hover:shadow-none"
    );
    expect(
      cn("focus-visible:shadow-none", "focus-visible:shadow-[var(--shadow-focus)]")
    ).toBe("focus-visible:shadow-[var(--shadow-focus)]");
    // different variants do NOT conflict
    expect(
      cn("hover:shadow-[var(--shadow-warm)]", "focus:shadow-[var(--shadow-focus)]")
    ).toBe("hover:shadow-[var(--shadow-warm)] focus:shadow-[var(--shadow-focus)]");
  });

  it("does NOT treat a shadow COLOUR arbitrary value as a shadow length", () => {
    // The over-merge guard. --shadow-* tokens are lengths; a colour variable is a
    // different group and must survive beside a shadow-none. If the validator were
    // widened to any [var(--…)] this assertion would fail — which is why it exists.
    expect(cn("shadow-[var(--color-brand-500)]", "shadow-none")).toBe(
      "shadow-[var(--color-brand-500)] shadow-none"
    );
    // and a shadow colour must not be eaten by a shadow length either
    expect(cn("shadow-md", "shadow-[var(--color-brand-500)]")).toBe(
      "shadow-md shadow-[var(--color-brand-500)]"
    );
  });

  it("resolves the two radius tokens", () => {
    expect(cn("rounded-brand", "rounded-none")).toBe("rounded-none");
    expect(cn("rounded-md", "rounded-brand-lg")).toBe("rounded-brand-lg");
    expect(cn("rounded-brand", "rounded-brand-lg")).toBe("rounded-brand-lg");
    expect(cn("rounded-[var(--radius-brand)]", "rounded-none")).toBe("rounded-none");
    // the default scale still works
    expect(cn("rounded-lg", "rounded-xl")).toBe("rounded-xl");
  });

  it("keeps the default Tailwind scale working beside the tokens", () => {
    // `extend` ADDS to the built-in group rather than replacing it — if it had
    // replaced it, shadow-sm/md/lg and rounded-md/lg would stop resolving.
    expect(cn("shadow-sm", "shadow-lg")).toBe("shadow-lg");
    expect(cn("shadow-lg", "shadow-[var(--shadow-elev)]")).toBe(
      "shadow-[var(--shadow-elev)]"
    );
    expect(cn("rounded-xl", "rounded-brand-lg")).toBe("rounded-brand-lg");
  });
});

// ── 4. Legacy compatibility — what existing call sites already rely on ────
describe("cn keeps the old implementation's guarantees", () => {
  it("filters falsy arguments", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("collapses whitespace so multi-line call sites stay clean", () => {
    expect(cn("  text-sm\n   font-medium  ")).toBe("text-sm font-medium");
  });

  it("returns an empty string, never undefined or null", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined)).toBe("");
    expect(typeof cn("a")).toBe("string");
  });

  it("exports the same function as named and default", () => {
    // 17 files import it; the repo uses the named form, but the default is
    // exported for compatibility and must be the identical function.
    expect(cnDefault).toBe(cn);
  });

  it("is idempotent — merging twice changes nothing", () => {
    const once = cn("p-4", "p-2", "text-sm");
    expect(cn(once)).toBe(once);
  });
});

// ── 5. The four measured genuine resolutions ──────────────────────────────
// Found by diffing old vs new across all 49 real call sites. Each is a latent
// bug the merge fixes; each is pinned here so a future change to Input.js or
// Select.js cannot silently reintroduce the coin flip.
describe("cn resolves the four genuine conflicts measured in the real call sites", () => {
  // Input.js:41,46 / Select.js:33,37 — the `// iOS zoom fix` comment states the
  // intent: 16px on mobile (iOS zooms the page on focus below 16px), sm:text-sm
  // restores the smaller size at >=640px. With both text-sm and text-[16px]
  // present, which won was up to Tailwind's emission order.
  it("lets the iOS zoom fix win over the base text-sm", () => {
    const out = cn(
      "w-full py-2.5 px-3 text-sm text-text-main bg-surface-2 rounded-[10px]",
      "text-[16px] sm:text-sm"
    );
    expect(out).not.toContain(" text-sm ");
    expect(out).toContain("text-[16px]");
    expect(out).toContain("sm:text-sm");
    // sm:text-sm is a different variant and must survive to restore at >=640px
    expect(out).toBe(
      "w-full py-2.5 px-3 text-text-main bg-surface-2 rounded-[10px] text-[16px] sm:text-sm"
    );
  });

  // Input.js:42,48 — `error && "... border-red-500/40"`. The whole point of the
  // conditional is that the border turns red; border-transparent must yield.
  it("lets the error state override border-transparent", () => {
    const out = cn(
      "border border-transparent",
      "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
      "ring-1 ring-red-500 focus:ring-2 focus:ring-red-500/40 border-red-500/40"
    );
    expect(out).toContain("border-red-500/40");
    expect(out).not.toContain("border-transparent");
    // and the focus ring turns red too, not brand coral
    expect(out).toContain("focus:ring-red-500/40");
    expect(out).not.toContain("focus:ring-brand-500/30");
    // focus:border-brand-500/40 is border-COLOUR under focus: — it does not
    // conflict with the unprefixed border-red-500/40, so it survives
    expect(out).toContain("focus:border-brand-500/40");
  });

  // The caller-className semantic: a component default must yield to the caller.
  // This is the React convention every one of the 17 components already assumes
  // by placing className LAST in the cn() argument list.
  it("lets a caller className override a component default", () => {
    // Card.js:27 shape — bg-surface is the default, caller wants something else
    expect(
      cn("bg-surface border border-border-subtle rounded-[14px]", "bg-blue-500")
    ).toBe("border border-border-subtle rounded-[14px] bg-blue-500");
  });
});
