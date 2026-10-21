// METRICS — dependency-free Prometheus exposition.
//
// Ported from 9router-go `internal/observ`. The Go harbor uses the official
// client; this harbor keeps the same metric names, labels, buckets and text
// format without adding a dependency to the hot path. A private registry per
// process means parallel gateways (and tests) cannot collide.
//
// Cardinality is the failure mode of every metrics layer: labels stay a closed
// set (provider/model/endpoint/status/kind/reason/detector/action/direction),
// never a free-form user value.
const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120];
const TTFT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30];
const QUEUE_BUCKETS = [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120];
const GUARDRAIL_BUCKETS = [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.1, 1];

function labelKey(labels) {
  return Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join("\u0000");
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labels) {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return "";
  return `{${keys.map((k) => `${k}="${escapeLabel(labels[k])}"`).join(",")}}`;
}

function mergeLabelKey(labels, extra) {
  return { ...labels, ...extra };
}

export class Counter {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.series = new Map(); // key -> { labels, value }
  }

  inc(labels = {}, value = 1) {
    const key = labelKey(labels);
    const series = this.series.get(key);
    if (series) series.value += value;
    else this.series.set(key, { labels: { ...labels }, value });
  }

  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.series.values()) {
      out.push(`${this.name}${formatLabels(labels)} ${value}`);
    }
    return out;
  }
}

export class Histogram {
  constructor(name, help, buckets, labelNames = []) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.labelNames = labelNames;
    this.series = new Map(); // key -> { labels, counts[], sum, count }
  }

  observe(labels = {}, value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const key = labelKey(labels);
    let series = this.series.get(key);
    if (!series) {
      series = { labels: { ...labels }, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, series);
    }
    series.sum += v;
    series.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (v <= this.buckets[i]) series.counts[i] += 1;
    }
  }

  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.series.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative = counts[i];
        out.push(`${this.name}_bucket${formatLabels(mergeLabelKey(labels, { le: String(this.buckets[i]) }))} ${cumulative}`);
      }
      out.push(`${this.name}_bucket${formatLabels(mergeLabelKey(labels, { le: "+Inf" }))} ${count}`);
      out.push(`${this.name}_sum${formatLabels(labels)} ${sum}`);
      out.push(`${this.name}_count${formatLabels(labels)} ${count}`);
    }
    return out;
  }
}

export class Metrics {
  constructor() {
    this.requestsTotal = new Counter(
      "router_requests_total",
      "Completed gateway requests by provider, model, endpoint and outcome.",
      ["provider", "model", "endpoint", "status"]
    );
    this.requestDuration = new Histogram(
      "router_request_duration_seconds",
      "End-to-end gateway request duration by provider and model.",
      LATENCY_BUCKETS
    );
    this.timeToFirstToken = new Histogram(
      "router_time_to_first_token_seconds",
      "Time from request start to the first streamed chunk; only observed for streaming turns.",
      TTFT_BUCKETS
    );
    this.tokensTotal = new Counter(
      "router_tokens_total",
      "Tokens billed through the gateway, split by kind.",
      ["provider", "model", "kind"]
    );
    this.costMicros = new Counter(
      "router_cost_micros_total",
      "Estimated spend in micro-units of the billing currency, by provider and model.",
      ["provider", "model"]
    );
    this.fallbacks = new Counter(
      "router_fallbacks_total",
      "Requests that moved to another upstream connection or provider.",
      ["provider", "model", "reason"]
    );
    this.upstreamErrors = new Counter(
      "router_upstream_errors_total",
      "Upstream responses the gateway treated as errors.",
      ["provider", "model", "status"]
    );
    this.guardrailDecisions = new Counter(
      "router_guardrail_decisions_total",
      "Guardrail decisions by detector, action and direction.",
      ["detector", "action", "direction"]
    );
    this.guardrailEval = new Histogram(
      "router_guardrail_eval_seconds",
      "Time spent scanning content against the guardrail detectors.",
      GUARDRAIL_BUCKETS,
      ["direction"]
    );
  }

  recordRequest({ provider = "", model = "", endpoint = "", status = 200, durationMs = 0 } = {}) {
    this.requestsTotal.inc({ provider, model, endpoint, status: String(status) });
    if (durationMs > 0) this.requestDuration.observe({ provider, model }, durationMs / 1000);
  }

  recordFallback({ provider = "", model = "", reason = "unknown" } = {}) {
    this.fallbacks.inc({ provider, model, reason });
  }

  recordUpstreamError({ provider = "", model = "", status = 502 } = {}) {
    this.upstreamErrors.inc({ provider, model, status: String(status) });
  }

  recordTokens({ provider = "", model = "", prompt = 0, completion = 0 } = {}) {
    if (prompt > 0) this.tokensTotal.inc({ provider, model, kind: "prompt" }, prompt);
    if (completion > 0) this.tokensTotal.inc({ provider, model, kind: "completion" }, completion);
  }

  recordGuardrailDecision({ detector = "", action = "", direction = "" } = {}) {
    this.guardrailDecisions.inc({ detector, action, direction });
  }

  observeGuardrailEval(direction, seconds) {
    this.guardrailEval.observe({ direction }, seconds);
  }

  render() {
    return [
      ...this.requestsTotal.render(),
      ...this.requestDuration.render(),
      ...this.timeToFirstToken.render(),
      ...this.tokensTotal.render(),
      ...this.costMicros.render(),
      ...this.fallbacks.render(),
      ...this.upstreamErrors.render(),
      ...this.guardrailDecisions.render(),
      ...this.guardrailEval.render(),
    ].join("\n") + "\n";
  }
}

export const metrics = new Metrics();
