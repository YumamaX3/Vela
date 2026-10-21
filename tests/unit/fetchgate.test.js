// FetchGate — pacing proof (ported from 9router-go internal/fetchgate).
import { describe, it, expect, vi } from "vitest";
import { FetchGate } from "@/lib/fetchgate.js";

describe("FetchGate", () => {
  it("spaces consecutive slots by at least the floor", async () => {
    const gate = new FetchGate(40, 0);
    const stamps = [];
    for (let i = 0; i < 3; i++) {
      await gate.acquire();
      stamps.push(Date.now());
    }
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(30); // timer tolerance
    expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(30);
  });

  it("hands out an immediate slot when the gate is idle", async () => {
    const gate = new FetchGate(40, 0);
    const started = Date.now();
    await gate.acquire();
    expect(Date.now() - started).toBeLessThan(25);
  });

  it("adds jitter on top of the floor, never below it", () => {
    const gate = new FetchGate(100, 50);
    const now = 1_000_000;
    gate.next = now;
    expect(gate.reserve(now)).toBe(0); // idle slot
    const wait = gate.reserve(now);    // the reserved slot, floor + jitter
    expect(wait).toBeGreaterThanOrEqual(100);
    expect(wait).toBeLessThanOrEqual(150);
  });

  it("rejects an aborted waiter and still consumed the slot", async () => {
    const gate = new FetchGate(5_000, 0);
    gate.next = Date.now() + 5_000;
    const controller = new AbortController();
    const pending = gate.acquire(controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // The reservation was taken before the wait: the gate did not collapse.
    expect(gate.next).toBeGreaterThan(Date.now());
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const gate = new FetchGate(5_000, 0);
    gate.next = Date.now() + 5_000;
    const controller = new AbortController();
    controller.abort();
    await expect(gate.acquire(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
