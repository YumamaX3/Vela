/**
 * W4 · Recovery — clinepassEnvelope (sibling-harbor-ports §3.1 row 7).
 *
 * The Cline / ClinePass upstream (api.cline.bot) wraps non-streaming JSON
 * responses in a `{success, data}` envelope; errors use `{success: false,
 * error}`. Consumers reading `choices`/`usage` at the top level see none and
 * report "Provider returned no completion choices for this model" (#3644).
 *
 * Two acceptance claims are pinned here:
 *   · a `{success:true, data:{…}}` envelope unwraps to the INNER object;
 *   · a bare object (no envelope) passes through UNCHANGED (reference-equal).
 *
 * The unwrap is scoped to providers that opt in via `quirks.clineEnvelope`
 * (merged to the top level by the registry schema), so the live-graph tripwire
 * below proves the quirk is actually reachable — a silent no-op would otherwise
 * keep these tests green while the fix evaporated.
 */
import { describe, it, expect } from "vitest";
import { unwrapClinepassEnvelope } from "../../open-sse/utils/clinepassEnvelope.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const ENVELOPE = {
  success: true,
  data: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { total_tokens: 7 } },
};

describe("unwrapClinepassEnvelope — pure guard table", () => {
  it("unwraps an opted-in provider's success envelope to the inner object", () => {
    expect(unwrapClinepassEnvelope(ENVELOPE, "clinepass")).toEqual({
      body: ENVELOPE.data,
      error: null,
    });
    expect(unwrapClinepassEnvelope(ENVELOPE, "cline")).toEqual({ body: ENVELOPE.data, error: null });
  });

  it("passes a bare object through unchanged (reference-equal)", () => {
    const bare = { choices: [{ message: { content: "hi" } }], usage: { total_tokens: 7 } };
    const out = unwrapClinepassEnvelope(bare, "clinepass");
    expect(out.error).toBeNull();
    expect(out.body).toBe(bare);
  });

  it("passes a bare object through unchanged even for a non-opted provider", () => {
    const bare = { choices: [] };
    expect(unwrapClinepassEnvelope(bare, "openai").body).toBe(bare);
    expect(unwrapClinepassEnvelope(bare, "claude").body).toBe(bare);
  });

  it("does NOT unwrap for a provider without the clineEnvelope quirk", () => {
    const out = unwrapClinepassEnvelope(ENVELOPE, "openai");
    expect(out.body).toBe(ENVELOPE);
    expect(out.error).toBeNull();
  });

  it("surfaces the error envelope as {body:null, error}", () => {
    const err = { success: false, error: "rate limited", statusCode: 429 };
    const out = unwrapClinepassEnvelope(err, "clinepass");
    expect(out.body).toBeNull();
    expect(out.error).toEqual({ message: "rate limited", status: 429 });
  });

  it("falls back to the nested error.message when error is not a string", () => {
    const out = unwrapClinepassEnvelope({ success: false, error: { message: "boom" } }, "clinepass");
    expect(out.error.message).toBe("boom");
  });

  it("survives malformed inputs without throwing", () => {
    expect(unwrapClinepassEnvelope(null, "clinepass")).toEqual({ body: null, error: null });
    expect(unwrapClinepassEnvelope(undefined, "clinepass")).toEqual({ body: undefined, error: null });
    expect(unwrapClinepassEnvelope(ENVELOPE, null).body).toBe(ENVELOPE);
    expect(unwrapClinepassEnvelope(ENVELOPE, "").body).toBe(ENVELOPE);
    // success:true but data is an Array → not unwrapped
    expect(unwrapClinepassEnvelope({ success: true, data: [1, 2] }, "clinepass").body).toEqual({ success: true, data: [1, 2] });
    // success:true but data is not an object → untouched
    expect(unwrapClinepassEnvelope({ success: true, data: "x" }, "clinepass").body).toEqual({ success: true, data: "x" });
    // an array body is never treated as an envelope
    expect(unwrapClinepassEnvelope([1, 2], "clinepass").body).toEqual([1, 2]);
  });
});

describe("the clineEnvelope quirk is LIVE on the merged provider graph (silent-no-op tripwire)", () => {
  it("PROVIDERS.cline / clinepass expose quirks.clineEnvelope at TOP level", () => {
    expect(PROVIDERS.cline?.quirks?.clineEnvelope).toBe(true);
    expect(PROVIDERS.clinepass?.quirks?.clineEnvelope).toBe(true);
    // control: claude must NOT carry it (guards against an over-broad merge)
    expect(PROVIDERS.claude?.quirks?.clineEnvelope).toBeUndefined();
  });

  it("end-to-end through the live graph: the unwrap returns choices", () => {
    const out = unwrapClinepassEnvelope(ENVELOPE, "clinepass");
    expect(Array.isArray(out.body.choices)).toBe(true);
    expect(out.body.usage.total_tokens).toBe(7);
  });
});

describe("DefaultExecutor wires the unwrap on the clinepass path (source contract)", () => {
  it("default.js imports and consults unwrapClinepassEnvelope in parseError", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const ex = new DefaultExecutor("clinepass");
    const parsed = ex.parseError(
      new Response("{}", { status: 400 }),
      JSON.stringify({ success: false, error: "upstream said no", statusCode: 429 })
    );
    expect(parsed.message).toBe("upstream said no");
    expect(parsed.status).toBe(429);
  });

  it("leaves a non-clinepass provider's error body untouched", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const ex = new DefaultExecutor("openai");
    const body = JSON.stringify({ success: false, error: "nope" });
    const parsed = ex.parseError(new Response("{}", { status: 400 }), body);
    expect(parsed.message).toBe(body);
  });
});
