// @vitest-environment happy-dom
// W5 — proof of the AI Lab deck: LabTabBar renders all six facets and honors
// the active tab; InjectorsTab lists injectors with enable state; LibraryTab
// shows honest expectedHonor labels; PoliciesTab surfaces the create path.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanupDom } from "./helpers/domRender.js";

vi.mock("@/i18n/runtime", () => ({ translate: (s) => s || "" }));

vi.mock("@/shared/components", () => ({
  // Faithful to the REAL Modal contract: visibility is `isOpen`, not `open`.
  // (The original mock used `open` and mirrored the buggy call sites — which
  // is why the isOpen fix slipped past the suite.)
  Modal: ({ isOpen, title, children, onClose }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        <button data-testid="modal-close" onClick={onClose}>close</button>
        {children}
      </div>
    ) : null,
  Button: ({ children, onClick, disabled, ...rest }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  Input: ({ label, value, onChange, placeholder, ...rest }) => (
    <div>
      {label ? <label>{label}</label> : null}
      <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />
    </div>
  ),
  Card: ({ children }) => <section>{children}</section>,
  CardSkeleton: () => <div data-testid="skeleton" />,
  Toggle: ({ checked, onChange, label }) => (
    <label>
      <input type="checkbox" checked={!!checked} onChange={onChange} />
      {label}
    </label>
  ),
}));

vi.mock("@/shared/hooks/useEndpointFacets", () => ({
  useEndpointFacets: () => ({ state: { tab: "injectors" }, setFacets: vi.fn() }),
}));

import LabTabBar from "../../src/app/(dashboard)/dashboard/ai-lab/components/LabTabBar.jsx";
import InjectorsTab from "../../src/app/(dashboard)/dashboard/ai-lab/components/InjectorsTab.jsx";
import LibraryTab from "../../src/app/(dashboard)/dashboard/ai-lab/components/LibraryTab.jsx";
import PoliciesTab from "../../src/app/(dashboard)/dashboard/ai-lab/components/PoliciesTab.jsx";

const SETTINGS = {
  userInjectors: [
    { id: "i1", name: "Indonesian-first", prompt: "Always Indonesian", position: "append", applyTo: "llm", enabled: true },
    { id: "i2", name: "Off", prompt: "x", position: "append", applyTo: "llm", enabled: false },
  ],
  modeBundles: [],
  contentPolicies: [],
  requireApiKey: true,
};

beforeEach(() => cleanupDom());

describe("AI Lab deck — W5 proof", () => {
  it("LabTabBar renders all six facets", async () => {
    const { text } = await render(<LabTabBar active="injectors" onSelect={() => {}} />);
    for (const label of ["Injectors", "Modes", "Policies", "Library", "Simulator", "Observe"]) {
      expect(text(label)).toBe(true);
    }
  });

  it("InjectorsTab lists injectors with enable state", async () => {
    const { text } = await render(<InjectorsTab settings={SETTINGS} onChange={() => {}} />);
    expect(text("Indonesian-first")).toBe(true);
    expect(text("enabled")).toBe(true);
    expect(text("disabled")).toBe(true);
  });

  it("LibraryTab shows honest expectedHonor labels as icon badges", async () => {
    const { text } = await render(<LibraryTab settings={SETTINGS} onChange={() => {}} />);
    expect(text("High")).toBe(true); // ✓ High — format/instruction presets
    expect(text("Low")).toBe(true); //  ⚠ Low — policy presets the injection can't guarantee
  });

  it("PoliciesTab surfaces the create path", async () => {
    const { text } = await render(<PoliciesTab settings={{ contentPolicies: [] }} onChange={() => {}} />);
    expect(text("Content Policies")).toBe(true);
    expect(text("New policy")).toBe(true);
  });

  it("New injector opens the editor modal (isOpen contract)", async () => {
    const { text, query, queryAll, flush } = await render(
      <InjectorsTab settings={SETTINGS} onChange={() => {}} />
    );
    // The modal must NOT be open before the click.
    expect(query("[data-testid=modal]")).toBeNull();
    // Click the "New injector" button.
    const btn = [...queryAll("button")].find((b) => b.textContent.includes("New injector"));
    expect(btn).toBeTruthy();
    btn.click();
    await flush();
    // The modal opens, titled "New injector".
    const modal = query("[data-testid=modal]");
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain("New injector");
  });
});
