// Metrics (Prometheus exposition) + tracing ring — ported from 9router-go.
import { describe, it, expect } from "vitest";
import { Metrics, Counter, Histogram } from "@/lib/metrics.js";
import { recordSpan, recentSpans, latencyByKey, tracesPayload, resetTracing } from "@/lib/tracing.js";

describe("Prometheus exposition", () => {
  it("renders counters and histograms in text format", () => {
    const m = new Metrics();
    m.recordRequest({ provider: "openai", model: "gpt", endpoint: "chat", status: 200, durationMs: 250 });
    m.recordUpstreamError({ provider: "openai", model: "gpt", status: 429 });
    const text = m.render();

    expect(text).toContain("# TYPE router_requests_total counter");
    expect(text).toContain('router_requests_total{endpoint="chat",model="gpt",provider="openai",status="200"} 1');
    expect(text).toContain('router_upstream_errors_total{model="gpt",provider="openai",status="429"} 1');
    expect(text).toContain("# TYPE router_request_duration_seconds histogram");
    expect(text).toContain('router_request_duration_seconds_bucket{le="0.25",model="gpt",provider="openai"} 1');
    expect(text).toContain('router_request_duration_seconds_bucket{le="+Inf",model="gpt",provider="openai"} 1');
    expect(text).toContain('router_request_duration_seconds_sum{model="gpt",provider="openai"} 0.25');
  });

  it("escapes quotes, backslashes and newlines in label values", () => {
    const c = new Counter("x_total", "help", ["k"]);
    c.inc({ k: 'a"b\\c\nd' });
    expect(c.render().join("\n")).toContain('x_total{k="a\\"b\\\\c\\nd"} 1');
  });

  it("keeps every observation in its histogram count", () => {
    const h = new Histogram("h_seconds", "help", [1, 5], []);
    h.observe({}, 0.5);
    h.observe({}, 3);
    h.observe({}, 10);
    const text = h.render().join("\n");
    expect(text).toContain('h_seconds_bucket{le="1"} 1');
    expect(text).toContain('h_seconds_bucket{le="5"} 2');
    expect(text).toContain('h_seconds_bucket{le="+Inf"} 3');
    expect(text).toContain("h_seconds_count 3");
    expect(text).toContain("h_seconds_sum 13.5");
  });
});

describe("tracing ring", () => {
  it("keeps recent spans and computes percentiles", () => {
    resetTracing();
    recordSpan({ provider: "p", model: "m", status: "200", durationMs: 100, at: 1000 });
    recordSpan({ provider: "p", model: "m", status: "200", durationMs: 300, at: 2000 });
    recordSpan({ provider: "p", model: "m", status: "500", durationMs: 500, at: 3000 });

    expect(recentSpans(2).map((s) => s.durationMs)).toEqual([300, 500]);
    const [stat] = latencyByKey();
    expect(stat).toMatchObject({ key: "p/m", count: 3, p50Ms: 300, p95Ms: 500, errors: 1, lastAt: 3000 });
    expect(tracesPayload(1).spans).toHaveLength(1);
    resetTracing();
  });

  it("bounds the ring at 2000 spans", () => {
    resetTracing();
    for (let i = 0; i < 2100; i++) recordSpan({ provider: "p", model: "m", durationMs: i });
    expect(recentSpans().length).toBe(2000);
    expect(recentSpans(1)[0].durationMs).toBe(2099);
    resetTracing();
  });
});
