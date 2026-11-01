// Responsive Tide P1 — the event-loop-lag instrument (plans/2026-11-01-responsive-tide-performance.md).
//
// Pins the three laws of src/lib/perf/eventLoopMonitor.js:
//   • ZERO-CONFIG — the monitor arms on create; bootEventLoopMonitor() is the
//     boot entry; VELA_EVENT_LOOP_MONITOR=off is the only disarm.
//   • CHEAP + ns→ms — perf_hooks reports nanoseconds; every emitted value is
//     milliseconds, finite, and rounded to 2dp. An empty window is `available:
//     false`, never "lag 0".
//   • FAIL-OPEN — the health route's `ok` is decided by the route answering,
//     never by the instrument. A throwing/absent monitor still yields `{ok:true}`
//     and a JSON-safe `eventLoop` block (no Infinity, no NaN).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  nsToMs,
  buildReport,
  createEventLoopMonitor,
  bootEventLoopMonitor,
  getEventLoopMonitor,
  eventLoopHealth,
  __resetEventLoopMonitorForTests,
} from "@/lib/perf/eventLoopMonitor.js";

const saved = { VELA_EVENT_LOOP_MONITOR: process.env.VELA_EVENT_LOOP_MONITOR };

beforeEach(() => {
  delete process.env.VELA_EVENT_LOOP_MONITOR;
  __resetEventLoopMonitorForTests();
});

afterEach(() => {
  __resetEventLoopMonitorForTests();
  if (saved.VELA_EVENT_LOOP_MONITOR === undefined) delete process.env.VELA_EVENT_LOOP_MONITOR;
  else process.env.VELA_EVENT_LOOP_MONITOR = saved.VELA_EVENT_LOOP_MONITOR;
  vi.restoreAllMocks();
});

/** A stand-in for a perf_hooks histogram — the shape Node actually exposes. */
function fakeHistogram({ p50 = 0, p95 = 0, p99 = 0, max = 0, min = 0, mean = 0, count = 0 } = {}) {
  const table = { 50: p50, 95: p95, 99: p99 };
  return {
    max, min, mean, count,
    percentile: (p) => table[p] ?? table[Math.round(p)] ?? null,
    reset: () => {},
  };
}

describe("nsToMs — the single conversion point", () => {
  it("converts nanoseconds to milliseconds", () => {
    expect(nsToMs(5_000_000)).toBe(5);
    expect(nsToMs(95_000_000)).toBe(95);
  });

  it("rounds to 2 decimal places (millisecond precision)", () => {
    expect(nsToMs(1_234_567)).toBe(1.23);
  });

  it("collapses Infinity / NaN / non-numbers to null — never a non-JSON value", () => {
    expect(nsToMs(Infinity)).toBeNull();
    expect(nsToMs(-Infinity)).toBeNull();
    expect(nsToMs(NaN)).toBeNull();
    expect(nsToMs(undefined)).toBeNull();
    expect(nsToMs("42")).toBeNull();
  });
});

describe("buildReport — ms lag with empty-window guards", () => {
  it("reports p50/p95/p99/max in MILLISECONDS from an ns histogram", () => {
    const report = buildReport({
      stats: fakeHistogram({
        p50: 12_000_000, p95: 95_000_000, p99: 240_000_000,
        max: 260_000_000, min: 1_000_000, mean: 30_000_000, count: 40,
      }),
      windowMs: 5_000,
      startedAt: "2026-11-01T00:00:00.000Z",
      resetAt: "2026-11-01T00:00:05.000Z",
    });
    expect(report.available).toBe(true);
    expect(report.windowMs).toBe(5_000);
    expect(report.samples).toBe(40);
    expect(report.lagMs).toEqual({ p50: 12, p95: 95, p99: 240, max: 260, min: 1, mean: 30 });
    expect(report.warn).toMatchObject({ p95Exceeded: false, maxExceeded: true });
  });

  it("an EMPTY window is available:false with null gaps — not lag 0", () => {
    // The REAL shape of an empty perf_hooks histogram (measured 2026-11-01):
    // percentile() → 0 (NOT Infinity), max → Infinity, min → 2^63-1 ns sentinel,
    // count → 0. The fake must mirror that, or it lies about what it stands in for.
    const report = buildReport({
      stats: fakeHistogram({ p50: 0, p95: 0, p99: 0, max: Infinity, min: 9223372036854775807, mean: 0, count: 0 }),
      windowMs: 5_000,
    });
    expect(report.available).toBe(false);
    expect(report.samples).toBe(0);
    expect(report.lagMs).toEqual({ p50: null, p95: null, p99: null, max: null, min: null, mean: null });
    expect(report.warn).toBeNull();
  });

  it("a report is always JSON-serializable — no Infinity, no NaN in the string", () => {
    const empty = buildReport({ stats: fakeHistogram({ p50: Infinity, max: Infinity, min: NaN, mean: NaN, count: 0 }), windowMs: 5_000 });
    const s = JSON.stringify(empty);
    expect(s).not.toMatch(/Infinity|NaN/);
    expect(JSON.parse(s).lagMs.max).toBeNull();
  });

  it("flags p95 above the 100ms plan threshold", () => {
    const report = buildReport({
      stats: fakeHistogram({ p50: 20_000_000, p95: 140_000_000, max: 200_000_000, min: 1, mean: 1, count: 10 }),
      windowMs: 5_000,
    });
    expect(report.warn.p95Exceeded).toBe(true);
    expect(report.warn.p95ThresholdMs).toBe(100);
  });
});

describe("createEventLoopMonitor — zero-config, cheap, fail-open", () => {
  it("arms on creation (on by default) and defaults to a 5s window", () => {
    const m = createEventLoopMonitor();
    try {
      expect(m.running).toBe(true);
      expect(m.resolutionMs).toBe(5_000);
    } finally {
      m.stop();
    }
  });

  it("read() always returns a report object — never throws, even after stop()", () => {
    const m = createEventLoopMonitor({ resolutionMs: 50 });
    m.stop();
    const report = m.read();
    expect(report).toBeTypeOf("object");
    expect(report).toHaveProperty("available");
    expect(report).toHaveProperty("lagMs");
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(JSON.stringify(report)).not.toMatch(/Infinity|NaN/);
  });

  it("toJson() is JSON-safe even if the internal read throws", () => {
    const m = createEventLoopMonitor();
    try {
      vi.spyOn(m, "read").mockImplementation(() => { throw new Error("boom"); });
      const json = m.toJson();
      expect(json.available).toBe(false);
      expect(() => JSON.stringify(json)).not.toThrow();
    } finally {
      m.stop();
    }
  });

  it("read() is NON-DESTRUCTIVE — repeated polls never reset the window", async () => {
    // The documented contract: the 5s timer owns read+reset; a caller reads.
    // Burn the loop, let the window accrue, then read THREE times — samples
    // must keep accruing across the reads, and p95 must not collapse to floor.
    const m = createEventLoopMonitor({ resolutionMs: 60_000 }); // tick far away
    try {
      const t = Date.now();
      while (Date.now() - t < 120) { Math.sqrt(Math.random()); }
      await new Promise((r) => setTimeout(r, 30));

      const first = m.read();
      const second = m.read();
      const third = m.read();

      expect(first.samples).toBeGreaterThan(0);
      // Non-destructive: the window is not wiped by being read.
      expect(second.samples).toBeGreaterThanOrEqual(first.samples);
      expect(third.samples).toBeGreaterThanOrEqual(second.samples);
      expect(third.available).toBe(true);
      expect(third.lagMs.p95).not.toBe(0); // not collapsed to the floor
    } finally {
      m.stop();
    }
  });

  it("readNow() IS the destructive seam — it closes the window", async () => {
    const m = createEventLoopMonitor({ resolutionMs: 60_000 });
    try {
      const t = Date.now();
      while (Date.now() - t < 60) { Math.sqrt(Math.random()); }
      await new Promise((r) => setTimeout(r, 20));
      expect(m.readNow().samples).toBeGreaterThan(0);
      expect(m.readNow().samples).toBe(0); // reset by the seam
    } finally {
      m.stop();
    }
  });

  it("a never-read, freshly armed monitor answers available:false (warming), not a reset error", () => {
    const m = createEventLoopMonitor({ resolutionMs: 60_000 });
    try {
      const warm = m.toJson();
      expect(warm.available).toBe(false);
      expect(warm.lagMs).toEqual({ p50: null, p95: null, p99: null, max: null, min: null, mean: null });
    } finally {
      m.stop();
    }
  });
});

describe("process singleton — the boot entry and the disable seam", () => {
  it("bootEventLoopMonitor() is on by default and returns a running monitor", () => {
    const m = bootEventLoopMonitor();
    expect(m).not.toBeNull();
    expect(m.running).toBe(true);
    expect(getEventLoopMonitor()).toBe(m); // one per process
  });

  it("VELA_EVENT_LOOP_MONITOR=off disarms boot with reason:disabled", () => {
    process.env.VELA_EVENT_LOOP_MONITOR = "off";
    expect(bootEventLoopMonitor()).toBeNull();
    const health = eventLoopHealth();
    expect(health).toMatchObject({ available: false, reason: "disabled", disabled: true });
  });

  it("reason distinguishes warming (armed, no sample yet) from empty (rotated silent)", () => {
    const m = createEventLoopMonitor({ resolutionMs: 60_000 });
    try {
      // Freshly armed, pre-first-window → warming
      expect(m.toJson().reason).toBe("warming");
    } finally { m.stop(); }
    // A buildReport over a zero-count window is `empty`, never "warming"
    const emptyReport = buildReport({ stats: { count: 0 }, windowMs: 5_000 });
    expect(emptyReport.reason).toBe("empty");
    expect(emptyReport.available).toBe(false);
  });

  it("eventLoopHealth() never throws and is JSON-safe", () => {
    bootEventLoopMonitor();
    // Give the loop one tick so the histogram can accrue a sample or two.
    const health = eventLoopHealth();
    expect(health).toBeTypeOf("object");
    expect(health).toHaveProperty("available");
    const s = JSON.stringify(health);
    expect(s).not.toMatch(/Infinity|NaN/);
  });
});

describe("the /api/health route — ok stays first, the instrument is additive", () => {
  it("answers {ok:true} with a JSON-safe eventLoop block", async () => {
    const { GET } = await import("@/app/api/health/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.json();
    expect(Object.keys(body)[0]).toBe("ok"); // Docker HEALTHCHECK parses ok first
    expect(body.ok).toBe(true);
    expect(body.eventLoop).toBeTypeOf("object");
    expect(body.eventLoop).toHaveProperty("available");
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/Infinity|NaN/);
  });

  it("stays {ok:true} even when the monitor is disabled", async () => {
    process.env.VELA_EVENT_LOOP_MONITOR = "off";
    const { GET } = await import("@/app/api/health/route.js");
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.eventLoop.available).toBe(false);
  });

  it("stays {ok:true} even when the monitor module throws at the seam", async () => {
    // Mock the seam the route imports so the *module* itself throws, proving
    // the route's try/catch is the last fail-open guard, not just the module's.
    vi.resetModules();
    vi.doMock("@/lib/perf/eventLoopMonitor.js", () => ({
      eventLoopHealth: () => { throw new Error("instrument down"); },
    }));
    try {
      const { GET } = await import("@/app/api/health/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.eventLoop).toEqual({ available: false });
    } finally {
      vi.doUnmock("@/lib/perf/eventLoopMonitor.js");
      vi.resetModules();
    }
  });

  it("OPTIONS preflight is an empty 204 with CORS", async () => {
    const { OPTIONS } = await import("@/app/api/health/route.js");
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
