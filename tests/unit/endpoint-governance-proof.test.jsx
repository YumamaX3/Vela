// @vitest-environment happy-dom
// W3b — proof of the W3a governance shell: GovernanceDrawer v2 (lifecycle
// pill, hygiene ring, tags, mutation ledger) + MintWizard + CommandPalette.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanupDom } from "./helpers/domRender.js";

vi.mock("@/i18n/runtime", () => ({ translate: (s) => s || "" }));

// GovernanceDrawer imports Button directly; MintWizard + AuditLedger import
// the barrel, which eagerly re-exports the whole shared component library
// (40+ JSX files). Mock both down to the primitives these components use —
// the shared components are already-proven building blocks, and the subject
// here is the endpoint component.
vi.mock("@/shared/components", () => ({
  Modal: ({ isOpen, title, children, onClose }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        <button data-testid="modal-close" onClick={onClose}>close</button>
        {children}
      </div>
    ) : null,
  Button: ({ children, onClick, disabled, icon, ...rest }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{icon ? "icon " : ""}{children}</button>
  ),
  Input: ({ label, value, onChange, placeholder, ...rest }) => (
    <div>
      {label ? <label>{label}</label> : null}
      <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />
    </div>
  ),
  Card: ({ children }) => <section>{children}</section>,
}));
vi.mock("@/shared/components/Button", () => ({
  default: ({ children, onClick, disabled, icon, ...rest }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{icon ? "icon " : ""}{children}</button>
  ),
}));

beforeEach(() => cleanupDom());

const NOW = new Date("2026-08-26T12:00:00.000Z").getTime();
const ISO = (ms) => new Date(ms).toISOString();

function activeKey(overrides = {}) {
  return {
    id: "k1",
    name: "Prod Key",
    keyPrefix: "vela-v1-ab3f…",
    keyHash: "abc",
    isActive: 1,
    createdAt: ISO(NOW - 86400000),
    deletedAt: null,
    ...overrides,
  };
}

describe("GovernanceDrawer v2", () => {
  const props = () => ({
    serverNow: NOW,
    onClose: vi.fn(), onCopy: vi.fn(), onPause: vi.fn(), onResume: vi.fn(),
    onRotate: vi.fn(), onDuplicate: vi.fn(), onRevive: vi.fn(), onTest: vi.fn(),
    onEdit: vi.fn(), onExpire: vi.fn(), onRenew: vi.fn(), onDelete: vi.fn(),
    onShare: vi.fn(),
  });

  it("renders the lifecycle pill (active)", async () => {
    const { default: GovernanceDrawer } = await import("@/app/(dashboard)/dashboard/endpoint/components/GovernanceDrawer");
    const r = await render(<GovernanceDrawer rowKey={activeKey()} {...props()} />);
    expect(r.text("Active")).toBe(true);
    expect(r.text("Prod Key")).toBe(true);
  });

  it("renders the revoked lifecycle + hygiene ring", async () => {
    const { default: GovernanceDrawer } = await import("@/app/(dashboard)/dashboard/endpoint/components/GovernanceDrawer");
    const r = await render(<GovernanceDrawer rowKey={activeKey({ isActive: 0, keyHash: null, revoked: true })} {...props()} />);
    expect(r.text("Revoked")).toBe(true);
    expect(r.text("hygiene")).toBe(true); // the hygiene strip renders
  });

  it("renders tags + add/remove controls", async () => {
    const { default: GovernanceDrawer } = await import("@/app/(dashboard)/dashboard/endpoint/components/GovernanceDrawer");
    const onAddTag = vi.fn();
    const onRemoveTag = vi.fn();
    const r = await render(<GovernanceDrawer rowKey={activeKey()} tags={["prod", "finance"]} onAddTag={onAddTag} onRemoveTag={onRemoveTag} {...props()} />);
    expect(r.text("prod")).toBe(true);
    expect(r.text("finance")).toBe(true);
    expect(r.query('input[placeholder*="tag"]')).toBeTruthy();
  });

  it("renders the mutation ledger feed", async () => {
    const { default: GovernanceDrawer } = await import("@/app/(dashboard)/dashboard/endpoint/components/GovernanceDrawer");
    const ledger = [
      { id: "led-1", surface: "rotate", outcome: "rotated", actorClass: "dashboard", createdAt: ISO(NOW - 3600000) },
      { id: "led-2", surface: "create", outcome: "minted", actorClass: "cli", createdAt: ISO(NOW - 7200000) },
    ];
    const r = await render(<GovernanceDrawer rowKey={activeKey()} ledger={ledger} {...props()} />);
    expect(r.text("Mutation history")).toBe(true);
    expect(r.text("rotate")).toBe(true);
    expect(r.text("create")).toBe(true);
  });

  it("returns null when no key is selected", async () => {
    const { default: GovernanceDrawer } = await import("@/app/(dashboard)/dashboard/endpoint/components/GovernanceDrawer");
    const r = await render(<GovernanceDrawer rowKey={null} serverNow={NOW} onClose={vi.fn()} />);
    expect(r.container.childElementCount).toBe(0);
  });
});

describe("MintWizard — template-driven create", () => {
  it("renders templates + a blank fallback, and mints via onMint", async () => {
    const { default: MintWizard } = await import("@/app/(dashboard)/dashboard/endpoint/components/MintWizard");
    const onMint = vi.fn().mockResolvedValue({ ok: true });
    const templates = [
      { id: "tpl-1", name: "Claude Code Workstation", description: "d", builtIn: true, acl: { allowedKinds: ["llm"] }, limits: { rateLimitRpm: 60 } },
      { id: "tpl-2", name: "Read-Only Observer", description: "r", builtIn: true, acl: {}, limits: {} },
    ];
    const r = await render(<MintWizard open templates={templates} templatesLoading={false} onMint={onMint} categories={[]} />);

    expect(r.text("Mint from Template")).toBe(true);
    expect(r.text("Claude Code Workstation")).toBe(true);
    expect(r.text("Read-Only Observer")).toBe(true);

    // Select the second template then mint.
    r.queryAll("button").find((b) => b.textContent.includes("Read-Only Observer")).click();
    await r.flush();
    r.queryAll("button").find((b) => b.textContent.includes("Mint Key")).click();
    await r.flush();
    expect(onMint).toHaveBeenCalled();
  });

  it("shows the loading state", async () => {
    const { default: MintWizard } = await import("@/app/(dashboard)/dashboard/endpoint/components/MintWizard");
    const r = await render(<MintWizard open templates={[]} templatesLoading onMint={vi.fn()} categories={[]} />);
    expect(r.text("Loading templates")).toBe(true);
  });
});

describe("CommandPalette — ⌘K quick navigation", () => {
  it("filters commands by query and runs the selected one", async () => {
    const { default: CommandPalette } = await import("@/app/(dashboard)/dashboard/endpoint/components/CommandPalette");
    const onRun = vi.fn();
    const onClose = vi.fn();
    const commands = [
      { id: "a", label: "Go to Keys", run: () => {} },
      { id: "b", label: "Create a key", run: () => {} },
    ];
    const r = await render(<CommandPalette open commands={commands} onRunCommand={onRun} onClose={onClose} />);

    expect(r.text("Go to Keys")).toBe(true);

    // Filter to one.
    const input = r.query("input");
    input.value = "create";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await r.flush();
    expect(r.text("Create a key")).toBe(true);

    // Run the (only) command via Enter — the palette listens on window, and
    // the bubbled keydown reaches it.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await r.flush();
    expect(onRun).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
