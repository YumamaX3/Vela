// @vitest-environment happy-dom
/**
 * LiveRequestPulse — the frame-shape regression (found live, v1.2.59 tide).
 *
 * The wire's `activeRequests` is an ARRAY of rows {model, provider, account,
 * count} (usageRepo.getActiveRequests) — the strip stored it raw and rendered
 * it as a child, so the first frame under REAL traffic threw React #31
 * ("Objects are not valid as a React child") and the room's error boundary
 * swallowed the hub. An empty dev harbor renders an empty array as nothing,
 * which is why only the live water caught it.
 *
 * This suite drives a real frame into the strip through a stubbed EventSource
 * and asserts the render: the count chips state numbers, the recent row
 * renders, and nothing throws. The pending chip reads the wire's counters
 * object ({byModel, byAccount}) as the sum of the byModel counters.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
vi.mock("@/i18n/runtime", () => ({ translate: (s) => s }));

import LiveRequestPulse from "@/app/(dashboard)/dashboard/endpoint/components/LiveRequestPulse";

// The wire shapes, verbatim from the usage repo: activeRequests rows carry
// {model, provider, account, count}; pending is the counters object.
const FRAME = {
  activeRequests: [
    { model: "gpt-5", provider: "openai", account: "Account 1234abcd", count: 2 },
    { model: "claude-x", provider: "anthropic", account: "Account 5678efgh", count: 1 },
  ],
  pending: { byModel: { "gpt-5|openai": 3, "claude-x|anthropic": 1 }, byAccount: {} },
  errorProvider: "",
  recentRequests: [
    { at: "2026-11-07T09:00:00Z", key: "sk-abcd", model: "gpt-5" },
  ],
};

class StubEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
    StubEventSource.last = this;
  }
  close() { this.closed = true; }
  emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
global.EventSource = StubEventSource;

const mounted = [];
function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ container, root });
  return { container, es: StubEventSource.last };
}
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("LiveRequestPulse — the frame shapes", () => {
  it("renders a real-traffic frame: the activeRequests array becomes a count", () => {
    const { container, es } = render(<LiveRequestPulse period="all" />);
    act(() => es.emit(FRAME));
    const text = container.textContent;
    expect(text).toContain("2 active"); // the array's length — never the array as a child
    expect(text).toContain("4 pending"); // the byModel counters' sum
    expect(text).toContain("sk-abcd"); // the row law: keyPrefix || key || model
  });

  it("keeps the strip standing when the frame is empty (no traffic)", () => {
    const { container, es } = render(<LiveRequestPulse period="all" />);
    act(() => es.emit({ activeRequests: [], pending: { byModel: {} }, errorProvider: "", recentRequests: [] }));
    expect(container.textContent).toContain("0 active");
  });
});
