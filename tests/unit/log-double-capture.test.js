/**
 * M1 — The Ring's True Suppression (sealed plan r3 §9, milestone M1's proof).
 *
 * The defect (measured in production by the Gate 15 refuter): one console.log
 * produced ring entry 1 AND raw line 1, because the suppression window closed
 * in appendLine's `finally` BEFORE the console wrapper's original write reached
 * the stdout tap.
 *
 * Why this suite exists even though log-harbor.test.jsx has a "never doubles"
 * case: inside the vitest runner, console.* is intercepted by vitest itself,
 * and that interceptor never routes through process.stdout.write — so the
 * harbor case cannot fail on the defect shape (it passed with the defect
 * planted; measured this tide). This file reproduces the production chain
 * mechanically instead: a fake "original" console.log is captured by the
 * wrapper (injected BEFORE initConsoleLogCapture runs) and writes to
 * process.stdout exactly the way node's real console does, so the tap's
 * suppression window is the only thing standing between the original write
 * and the raw ring. Plant the defect (window closes before the original
 * write) and the second case goes red on its raw-ring assertion alone.
 */
import { describe, it, expect } from "vitest";
import {
  initConsoleLogCapture,
  clearConsoleLogs,
  getRawLogs,
  getConsoleLogs,
} from "@/lib/consoleLogBuffer.js";

// The production chain, rebuilt: node's real console.log ends in a
// process.stdout.write; this fake does the same thing, and the capture
// wrapper below will hold it as `state.originals.log`.
console.log = (...args) => {
  process.stdout.write(`VIA-ORIGINAL ${args.map(String).join(" ")}\n`);
};
initConsoleLogCapture();

const settle = () => new Promise((r) => setTimeout(r, 120));

describe("the ring's true suppression (M1)", () => {
  it("the tap is listening (control)", async () => {
    clearConsoleLogs();
    process.stdout.write("tap-control direct line\n");
    await settle();
    const raw = getRawLogs();
    expect(raw.some((e) => e.message.includes("tap-control direct line"))).toBe(true);
  });

  it("one console call is one structured entry and zero raw lines", async () => {
    clearConsoleLogs();
    console.log("double-capture probe line");
    await settle();
    const structured = getConsoleLogs({ structured: true }).filter((e) =>
      e.message.includes("double-capture probe line")
    );
    expect(structured.length).toBe(1);
    expect(getRawLogs().some((e) => e.message.includes("double-capture probe line"))).toBe(false);
  });
});
