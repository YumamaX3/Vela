// @vitest-environment happy-dom
/**
 * The Log Harbor — its producer and its three streams.
 *
 * /dashboard/logs gathers what used to be two rooms (Console Log and Request
 * Logs) and adds a third stream this tide: the Container tap, which reads what
 * the process itself prints to stdout/stderr and streams the lines over the
 * console-logs SSE channel as `{type:"raw"}`.
 *
 * These cases drive the REAL producer (src/lib/consoleLogBuffer.js) and the
 * REAL consumers (the three stream components) rather than hand-built shapes,
 * because the shapes are the contract the SSE route carries:
 *   init  → { type:"init", logs:[…], rawLogs:[…] }
 *   live  → { type:"raw", entries:[…] }
 *   clear → { type:"clear" }
 *
 * A regression here is consumer-visible on a live shore — a line that never
 * renders, a stream filter that hides the wrong side, a level that reaches the
 * wrong chip, a ledger column that shifts — which is what makes it worth a
 * permanent seat rather than a throwaway probe.
 *
 * Note: the probe lines below are written through the real tap, so they appear
 * in the runner's stdout. That noise is the proof, not a leak.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  initConsoleLogCapture,
  clearConsoleLogs,
  getRawLogs,
  getConsoleLogs,
  getConsoleEmitter,
} from "@/lib/consoleLogBuffer";

// ── A fake EventSource that replays one real init frame ─────────────────────
let initPayload = null;
class FakeEventSource {
  constructor() {
    setTimeout(() => {
      this.onopen?.();
      this.onmessage?.({ data: JSON.stringify(initPayload) });
    }, 0);
  }
  close() {}
}
vi.stubGlobal("EventSource", FakeEventSource);

import ContainerStream from "@/app/(dashboard)/dashboard/logs/ContainerStream.js";
import ConsoleStream from "@/app/(dashboard)/dashboard/logs/ConsoleStream.js";
import RequestLedger from "@/app/(dashboard)/dashboard/logs/RequestLedger.js";
import ConsoleLogPage from "@/app/(dashboard)/dashboard/console-log/page.js";

/** One of everything, through the real tap and the real console capture. */
const emitProbe = () => {
  process.stdout.write("harbor-probe: stdout line\n");
  process.stderr.write("harbor-probe: stderr line\n");
  console.log("harbor-probe: console line");
};

let container;
let root;
const mount = async (Comp) => {
  await act(async () => {
    root.render(<Comp />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const flat = () => container.textContent.replace(/\s+/g, " ");
const chips = () => [...container.querySelectorAll("button")].map((b) => b.textContent.trim());

beforeEach(() => {
  initConsoleLogCapture();
  clearConsoleLogs();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────
// The producer — the tap
// ────────────────────────────────────────────────────────────────
describe("the container tap", () => {
  it("captures both streams, classifies them, and emits live", async () => {
    clearConsoleLogs();
    const live = [];
    getConsoleEmitter().on("raw", (entries) => live.push(...entries));
    process.stdout.write("harbor-probe: stdout line\n");
    process.stderr.write("harbor-probe: stderr line\n");
    process.stdout.write("Traceback (most recent call last):\n");
    process.stdout.write("DeprecationWarning: an old warning\n");
    await new Promise((r) => setTimeout(r, 120));
    const raw = getRawLogs();
    expect(raw.length).toBe(4);
    // stderr is an error; a stdout traceback or warning is not mere output.
    const byMsg = (frag) => raw.find((e) => e.message.includes(frag));
    expect(byMsg("stdout line")).toMatchObject({ level: "LOG", stream: "stdout" });
    expect(byMsg("stderr line")).toMatchObject({ level: "ERROR", stream: "stderr" });
    expect(byMsg("Traceback").level).toBe("ERROR");
    expect(byMsg("DeprecationWarning").level).toBe("ERROR");
    // The live event is the exact frame the SSE route forwards.
    expect(live.length).toBe(4);
    // Every entry carries the shape the client reads.
    for (const e of raw) {
      expect(typeof e.id).toBe("string");
      expect(typeof e.seq).toBe("number");
      expect(typeof e.time).toBe("string");
      expect(typeof e.iso).toBe("string");
      expect(typeof e.raw).toBe("string");
      expect(Array.isArray(e.tags)).toBe(true);
    }
  });

  it("never doubles a console.* line into the raw ring", async () => {
    clearConsoleLogs();
    emitProbe();
    await new Promise((r) => setTimeout(r, 120));
    expect(getRawLogs().some((e) => e.message.includes("console line"))).toBe(false);
    expect(getConsoleLogs({ structured: true }).some((e) => e.message.includes("console line"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// The Container stream — rows, chips, filters
// ────────────────────────────────────────────────────────────────
describe("the Container stream renders what the tap produced", () => {
  it("paints one row per raw line and counts them by level", async () => {
    clearConsoleLogs();
    emitProbe();
    await new Promise((r) => setTimeout(r, 120));
    initPayload = { type: "init", logs: getConsoleLogs({ structured: true }), stats: {}, structured: true, rawLogs: getRawLogs() };
    await mount(ContainerStream);
    expect(flat()).toContain("harbor-probe: stdout line");
    expect(flat()).toContain("harbor-probe: stderr line");
    expect(flat()).toContain("Raw process stream");
    expect(flat()).toContain("stdout 1 · stderr 1");
    expect(chips()).toContain("LOG1");
    expect(chips()).toContain("ERROR1");
    expect(flat()).not.toContain("Nothing raw has surfaced yet");
  });

  it("the stream filter hides the other side, and search answers only to matches", async () => {
    clearConsoleLogs();
    emitProbe();
    await new Promise((r) => setTimeout(r, 120));
    initPayload = { type: "init", logs: [], stats: {}, structured: true, rawLogs: getRawLogs() };
    await mount(ContainerStream);
    const stderrBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("stderr"));
    await act(async () => stderrBtn.click());
    expect(flat()).toContain("harbor-probe: stderr line");
    expect(flat()).not.toContain("harbor-probe: stdout line");
    // Search narrows within the filtered set.
    const input = container.querySelector('input[type="text"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "no such line");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(flat()).toContain("No raw lines answer to the current filters");
  });

  it("shows the empty state in the Keeper's voice when nothing has surfaced", async () => {
    clearConsoleLogs();
    initPayload = { type: "init", logs: [], stats: {}, structured: true, rawLogs: [] };
    await mount(ContainerStream);
    expect(flat()).toContain("Nothing raw has surfaced yet");
    expect(chips()).toContain("LOG0");
  });
});

// ────────────────────────────────────────────────────────────────
// The Console stream — structured only
// ────────────────────────────────────────────────────────────────
describe("the Console stream renders the structured entries", () => {
  it("paints the console line and never a raw-only line", async () => {
    clearConsoleLogs();
    emitProbe();
    await new Promise((r) => setTimeout(r, 120));
    initPayload = { type: "init", logs: getConsoleLogs({ structured: true }), stats: {}, structured: true, rawLogs: getRawLogs() };
    await mount(ConsoleStream);
    expect(flat()).toContain("harbor-probe: console line");
    expect(flat()).not.toContain("harbor-probe: stdout line");
    expect(flat()).toContain("Levels");
    expect(flat()).toContain("Buffered");
  });
});

// ────────────────────────────────────────────────────────────────
// The Request ledger
// ────────────────────────────────────────────────────────────────
describe("the Request ledger renders from /api/usage/logs", () => {
  it("parses pipe-delimited lines into seven columns with an honest error count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          "23-08-2026 17:25:54|x-preview-f-free|OPENCODE|a@b.c|95322|1497|ok",
          "23-08-2026 17:21:57|claude-opus-4|Anthropic|x@y.z|10|20|429 daily quota",
        ],
      })
    );
    await mount(RequestLedger);
    expect(flat()).toContain("x-preview-f-free");
    expect(flat()).toContain("OPENCODE");
    expect(flat()).toContain("95322");
    expect(flat()).toContain("429 daily quota");
    expect(flat()).toContain("Showing 2 of 2");
    expect(chips()).toContain("Error1");
  });
});

// ────────────────────────────────────────────────────────────────
// The retired room
// ────────────────────────────────────────────────────────────────
describe("the retired Console Log room", () => {
  it("redirects into the harbor's Console stream rather than 404ing", () => {
    let digest = "";
    try {
      ConsoleLogPage();
    } catch (err) {
      digest = String(err?.digest || err?.message || err);
    }
    expect(digest).toContain("/dashboard/logs?tab=console");
  });
});
