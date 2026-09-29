// @vitest-environment happy-dom
/**
 * The living chart's contract — what `useNavPulse` promises the rail (v1.0.32).
 *
 * WHY THIS SUITE EXISTS. The helm's tiles read this hook, and three of its
 * promises are load-bearing in a way a screenshot cannot show:
 *
 *   1. A FAILED REFETCH KEEPS THE LAST GOOD CENSUS. A rail that empties itself
 *      on a transient hiccup is more alarming than one that is briefly stale —
 *      an operator reading "14" and then nothing cannot tell a network blink
 *      from a fleet that vanished. So `pulse` survives a rejection, and only
 *      `error` changes.
 *   2. A CANCELLED POLL IS NOT A FAILURE. Unmount, route change and a manual
 *      refresh all abort the in-flight request; the hook swallows `AbortError`
 *      rather than reporting a teardown as a fault.
 *   3. `intervalMs: 0` SCHEDULES NOTHING AT ALL — not a poll cadence, and not
 *      even the opening read: the effect returns before the first `load`, so a
 *      rail mounted with 0 stays null and `loading` false. That is what the
 *      hook's own docblock promises, and the helm relies on the default 60000.
 *
 * The hook is exercised the way the helm uses it — a probe component rendered
 * into a real DOM, reading the returned state — rather than with a harness the
 * house does not use anywhere else.
 *
 * TIMER DISCIPLINE (learned by failing this suite once): `flush()` waits on a
 * macrotask, which is exactly what fake timers freeze — so the fake-timer cases
 * flush with `advanceTimersByTimeAsync`, which drains promise chains AND moves
 * the clock, and the real-timer cases keep the macrotask wait.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The rail is only polled while the tab is visible; the probe stands on the
// visible shore so the polling effect is the thing under test, not visibility.
vi.mock("@/shared/hooks/usePageVisible", () => ({ default: () => true }));

import useNavPulse from "@/shared/hooks/useNavPulse";

const CENSUS = {
  ts: 1,
  sources: { keys: true, providers: true, combos: true, proxy: true, usage: true, errors: true },
  providers: { total: 14, healthy: 13, idle: 1, worst: "idle" },
};

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
/** Real timers: let the fetch → json() → setState chain settle. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** Fake timers: drain the same chain without waiting on a frozen clock. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const read = (container, key) => container.querySelector(`[data-t="${key}"]`).textContent;

function Probe({ intervalMs = 60000 }) {
  const { pulse, loading, error, refresh } = useNavPulse({ intervalMs });
  return (
    <div>
      <span data-t="loading">{String(loading)}</span>
      <span data-t="pulse">{pulse ? JSON.stringify(pulse) : "null"}</span>
      <span data-t="error">{error ? error.message : "none"}</span>
      <button data-t="refresh" onClick={refresh}>refresh</button>
    </div>
  );
}

beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe("useNavPulse — the rail never blanks", () => {
  it("loads once, then reports a failed refetch as an error while KEEPING the census", async () => {
    global.fetch.mockResolvedValueOnce(ok(CENSUS));
    const { container } = render(<Probe />);
    await flush();

    expect(read(container, "loading")).toBe("false");
    expect(JSON.parse(read(container, "pulse")).providers.total).toBe(14);
    expect(read(container, "error")).toBe("none");

    // The fleet hiccups: the next poll rejects outright.
    global.fetch.mockRejectedValueOnce(new Error("network down"));
    act(() => container.querySelector('[data-t="refresh"]').click());
    await flush();

    expect(read(container, "error")).toBe("network down");
    // THE CONTRACT: the last good census is still on the rail.
    expect(JSON.parse(read(container, "pulse")).providers.total).toBe(14);
  });

  it("treats a cancelled poll as a teardown, not as a fault", async () => {
    global.fetch.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
    );
    const { container } = render(<Probe />);
    await flush();

    expect(read(container, "error")).toBe("none");
    expect(read(container, "pulse")).toBe("null");
    // The spinner still has to be released, or a remount would show it forever.
    expect(read(container, "loading")).toBe("false");
  });

  it("schedules NOTHING at all when intervalMs is 0 — not even the opening read", async () => {
    vi.useFakeTimers();
    global.fetch.mockResolvedValue(ok(CENSUS));
    const { container } = render(<Probe intervalMs={0} />);
    await settle();

    expect(global.fetch).toHaveBeenCalledTimes(0);
    expect(read(container, "pulse")).toBe("null");
    expect(read(container, "loading")).toBe("false");

    await act(async () => { await vi.advanceTimersByTimeAsync(180000); });
    expect(global.fetch).toHaveBeenCalledTimes(0);
  });

  it("polls on cadence while the page is visible", async () => {
    vi.useFakeTimers();
    global.fetch.mockResolvedValue(ok(CENSUS));
    render(<Probe intervalMs={60000} />);
    await settle();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("asks for a no-store read of the census door", async () => {
    global.fetch.mockResolvedValue(ok(CENSUS));
    const { container } = render(<Probe />);
    await flush();

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/nav/pulse");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(read(container, "pulse")).not.toBe("null");
  });
});
