// @vitest-environment happy-dom
// W3b — proof of the W3a shell: TabBar facet switching + AuditLedger render.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanupDom } from "./helpers/domRender.js";

// The components import "@/i18n/runtime" (translate) — a no-op for en.
vi.mock("@/i18n/runtime", () => ({ translate: (s) => s || "" }));

// AuditLedger imports Card from the barrel, which eagerly re-exports the whole
// shared component library (40+ JSX files). Mock the barrel down to the one
// primitive the proof needs — the shared components are already-proven
// building blocks, and the subject here is the endpoint component.
vi.mock("@/shared/components", () => ({
  Card: ({ children, title }) => (
    <section data-testid="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
}));

beforeEach(() => cleanupDom());

describe("TabBar — URL-facet navigation", () => {
  it("renders all four tabs and highlights the active one", async () => {
    const { default: TabBar } = await import("@/app/(dashboard)/dashboard/endpoint/components/TabBar");
    const onSelect = vi.fn();
    const r = await render(<TabBar active="keys" onSelect={onSelect} />);

    expect(r.text("Overview")).toBe(true);
    expect(r.text("Keys")).toBe(true);
    expect(r.text("Tools")).toBe(true);
    expect(r.text("Audit")).toBe(true);

    // Active tab has aria-selected + the brand pill.
    const active = r.query('[role="tab"][aria-selected="true"]');
    expect(active).toBeTruthy();
    expect(active.textContent).toContain("Keys");
  });

  it("switches via onSelect", async () => {
    const { default: TabBar } = await import("@/app/(dashboard)/dashboard/endpoint/components/TabBar");
    const onSelect = vi.fn();
    const r = await render(<TabBar active="overview" onSelect={onSelect} />);

    const audit = r.queryAll('[role="tab"]').find((el) => el.textContent.includes("Audit"));
    expect(audit).toBeTruthy();
    audit.click();
    expect(onSelect).toHaveBeenCalledWith("audit");
  });
});

describe("AuditLedger — mutation ledger render", () => {
  it("renders ledger rows with surface + actor + relative time", async () => {
    const { default: AuditLedger } = await import("@/app/(dashboard)/dashboard/endpoint/components/AuditLedger");
    const ledger = [
      { id: "led-1", surface: "create", outcome: "minted", actorClass: "dashboard", createdAt: new Date(Date.now() - 60000).toISOString() },
      { id: "led-2", surface: "rotate", outcome: "rotated", actorClass: "cli", createdAt: new Date(Date.now() - 3600000).toISOString() },
    ];
    const onSelectKey = vi.fn();
    const r = await render(<AuditLedger ledger={ledger} loading={false} onSelectKey={onSelectKey} />);

    expect(r.text("Mutation Ledger")).toBe(true);
    expect(r.text("create")).toBe(true);
    expect(r.text("rotate")).toBe(true);
    expect(r.text("dashboard")).toBe(true);
    expect(r.text("cli")).toBe(true);
  });

  it("renders the empty state", async () => {
    const { default: AuditLedger } = await import("@/app/(dashboard)/dashboard/endpoint/components/AuditLedger");
    const r = await render(<AuditLedger ledger={[]} loading={false} />);
    expect(r.text("No key mutations yet")).toBe(true);
  });

  it("selecting a row with a keyId fires onSelectKey", async () => {
    const { default: AuditLedger } = await import("@/app/(dashboard)/dashboard/endpoint/components/AuditLedger");
    const onSelectKey = vi.fn();
    const ledger = [{ id: "led-1", surface: "revoke", outcome: "revoked", actorClass: "dashboard", keyId: "k1", createdAt: new Date().toISOString() }];
    const r = await render(<AuditLedger ledger={ledger} loading={false} onSelectKey={onSelectKey} />);

    r.container.querySelector("button").click();
    expect(onSelectKey).toHaveBeenCalledWith("k1");
  });
});
