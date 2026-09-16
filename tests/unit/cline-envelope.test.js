/**
 * ADR-004 M2 (upstream 122f23ee, envelope leg only) — Cline's non-stream
 * {"success":true,"data":{...choices...}} envelope must be unwrapped before any
 * consumer reads choices/usage, or the dashboard ping and the proxy both report
 * a false "Provider returned no completion choices for this model" (#3644).
 *
 * Three layers of proof, because the risk is a SILENT NO-OP:
 *  · the pure unwrap's guard table (envelope shape, opt-in scoping, error body
 *    untouched, non-object/Array guards);
 *  · a LIVE hoist tripwire — unwrapClineEnvelope gates on PROVIDERS[p]?.quirks
 *    ?.clineEnvelope, but the registry declares it under transport.quirks; the
 *    provider schema must hoist it to top level. If that merge ever changes,
 *    the fix evaporates with green tests — this case pins it against the real
 *    module graph, the same way M0's registry tripwire does;
 *  · source-contract guards that BOTH call-sites (nonStreamingHandler +
 *    models/test/ping) actually invoke the unwrap — the fold's "grep the wire
 *    dead" law made mechanical, so a future refactor can't silently drop a leg.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unwrapClineEnvelope } from "../../open-sse/shared/clineEnvelope.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const ENVELOPE = {
  success: true,
  data: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { total_tokens: 7 } },
};

describe("unwrapClineEnvelope — pure guard table", () => {
  it("unwraps a opted-in provider's success envelope", () => {
    expect(unwrapClineEnvelope(ENVELOPE, "cline")).toEqual(ENVELOPE.data);
    expect(unwrapClineEnvelope(ENVELOPE, "clinepass")).toEqual(ENVELOPE.data);
  });
  it("leaves a non-opted provider's body byte-identical (reference-equal)", () => {
    // claude has no clineEnvelope quirk → the SAME object comes back, no rewrite.
    expect(unwrapClineEnvelope(ENVELOPE, "claude")).toBe(ENVELOPE);
    expect(unwrapClineEnvelope(ENVELOPE, "openai")).toBe(ENVELOPE);
  });
  it("passes the error envelope through untouched", () => {
    const err = { success: false, msg: "rate limited", code: 429 };
    expect(unwrapClineEnvelope(err, "cline")).toBe(err);
  });
  it("survives malformed inputs without throwing", () => {
    expect(unwrapClineEnvelope(null, "cline")).toBeNull();
    expect(unwrapClineEnvelope(undefined, "cline")).toBeUndefined();
    expect(unwrapClineEnvelope(ENVELOPE, null)).toBe(ENVELOPE);   // no provider → guarded
    expect(unwrapClineEnvelope(ENVELOPE, "")).toBe(ENVELOPE);      // empty provider
    // success:true but data is an Array (embedding/image shapes) → not unwrapped
    expect(unwrapClineEnvelope({ success: true, data: [1, 2] }, "cline").data).toEqual([1, 2]);
    // success:true but data is not an object → untouched
    expect(unwrapClineEnvelope({ success: true, data: "x" }, "cline")).toEqual({ success: true, data: "x" });
  });
});

describe("the clineEnvelope quirk is LIVE on the merged provider graph (silent-no-op tripwire)", () => {
  // The registry declares `transport.quirks.clineEnvelope`; the guard reads
  // `PROVIDERS[p].quirks.clineEnvelope`. Only the schema's top-level hoist
  // connects them — M0's tool-type gate rides the SAME hoist, so a merge change
  // would break both silently. Pin it against the real module graph, not a mock.
  it("PROVIDERS.cline / clinepass expose quirks.clineEnvelope at TOP level", () => {
    expect(PROVIDERS.cline?.quirks?.clineEnvelope).toBe(true);
    expect(PROVIDERS.clinepass?.quirks?.clineEnvelope).toBe(true);
    // and a control: claude must NOT (guards the guard from an over-broad merge)
    expect(PROVIDERS.claude?.quirks?.clineEnvelope).toBeUndefined();
  });
  it("end-to-end: the pure unwrap engaged by the live graph returns choices", () => {
    const out = unwrapClineEnvelope(ENVELOPE, "cline");
    expect(Array.isArray(out.choices)).toBe(true);
    expect(out.usage.total_tokens).toBe(7);
  });
});

describe("both call-sites engage the unwrap (source-contract, fold 'grep the wire dead')", () => {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
  it("nonStreamingHandler unwraps before the body is consumed/translated", () => {
    const src = read("open-sse/handlers/chatCore/nonStreamingHandler.js");
    expect(src).toContain('import { unwrapClineEnvelope } from "../../shared/clineEnvelope.js"');
    // the unwrap line must precede logProviderResponse (the first big consumer)
    const u = src.indexOf("responseBody = unwrapClineEnvelope(responseBody, provider)");
    const l = src.indexOf("reqLogger.logProviderResponse");
    expect(u).toBeGreaterThan(-1);
    expect(l).toBeGreaterThan(u);
  });
  it("models/test/ping unwraps on the chat lane, deriving the provider from the model id", () => {
    const src = read("src/app/api/models/test/ping.js");
    expect(src).toContain('from "open-sse/shared/clineEnvelope.js"');
    expect(src).toMatch(/unwrapClineEnvelope\(\s*parsed,\s*resolveProviderId\(/);
  });
});
