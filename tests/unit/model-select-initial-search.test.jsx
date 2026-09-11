// @vitest-environment happy-dom
/**
 * ModelSelectModal — the `initialSearch` seed (v0.9.60, the Single Mast).
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * The header's ModelPickerCluster opens this modal seeded with the operator's
 * typed query or a recents pill's name. The seed travels as the
 * `initialSearch` prop and initializes `searchQuery` in its useState — NOT
 * via an effect. Two regressions this suite pins:
 *
 * 1. The seed must land in the search input on open (the picker is one
 *    Enter away instead of a retype).
 * 2. The seed must NOT resurrect after a close: the modal resets
 *    searchQuery to "" when the operator closes it or picks, so reopening
 *    with the same seed prop value must start clean — the effect form of
 *    seeding would have re-applied the prop on every re-render and fought
 *    the reset. (The useState initializer runs once per mount, so the
 *    parent REMOUNTS the modal per open — key or conditional render.)
 *
 * ── ENVIRONMENT NOTES ───────────────────────────────────────────────────────
 * The modal fetches four endpoints on open (combos / provider-nodes /
 * models/custom / models/disabled); fetch is stubbed to a settled empty
 * shape. Modal internals (Drawer/Modal base) render via a portal — the
 * assertions query document.body, not the mount container.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({
  useModelCaps: () => ({ getCaps: () => ({}) }),
}));

import ModelSelectModal from "@/shared/components/ModelSelectModal";

let container;
let root;

async function mountModal(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ModelSelectModal isOpen onClose={() => {}} onSelect={() => {}} {...props} />
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
  }));
});

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function searchInput() {
  return document.querySelector('input[type="text"]');
}

describe("ModelSelectModal initialSearch seed", () => {
  it("lands the seed in the search field on open", async () => {
    await mountModal({ initialSearch: "glm" });
    const input = searchInput();
    expect(input, "modal search input not found").toBeTruthy();
    expect(input.value).toBe("glm");
  });

  it("starts empty when no seed is passed (default behavior unchanged)", async () => {
    await mountModal({});
    expect(searchInput().value).toBe("");
  });
});
