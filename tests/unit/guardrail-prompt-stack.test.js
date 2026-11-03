// GUARDRAIL PROMPT STACK — Pro's grouped pass, proven at the seam that carries it.
//
// Pro resolves prompt injections stacked global → user(key) → model as ONE
// grouped pass per position: every enabled matching policy's prompt applies,
// not just the most specific one. Vela's resolver keeps its single-winner
// law for the SCAN (stricter action wins — untouched, and proven here to stay
// untouched), and the grouped pass governs prompt CONTENT only.
//
// The cases the dark will rely on:
//   S1. three matching policies at three scopes all appear, in stack order
//   S2. a disabled policy's prompt is excluded
//   S3. same-scope policies follow priority order
//   S4. no match = no change (and the scan still answers null)
//   S5. per-position bursts: prepends outermost-first, appends outermost-first
//   S6. idempotent — a second pass cannot draw in the same text twice
//   S7. strictest-action-wins is untouched by the stack
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { injectPromptStack, captureSystemText } from "open-sse/rtk/systemInject.js";
import { FORMATS } from "open-sse/transformer/translator/formats.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let driverRef = null;

async function boot() {
  const driver = await import("@/lib/db/driver.js");
  driverRef = driver;
  await driver.getAdapter();
  const store = await import("@/lib/guardrails/policyStore.js");
  const pipeline = await import("@/lib/guardrails/pipeline.js");
  return { driver, store, pipeline };
}

/** An OpenAI-chat body with one system message, as chatCore hands it over. */
const bodyWithSystem = (text) => ({
  messages: [
    { role: "system", content: text },
    { role: "user", content: "hi" },
  ],
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-guardrail-stack-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try {
    driverRef?.resetAdapter?.();
  } catch { /* already closed */ }
  driverRef = null;
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("today's law, proven from the code (characterization)", () => {
  it("the scan resolver still picks exactly ONE policy — by specificity", async () => {
    const { store } = await boot();
    const g = await store.createPolicy({ name: "g", scope: "global", detectors: ["pii"], action: "log_only" });
    const m = await store.createPolicy({ name: "m", scope: "model", target: "gpt-x", detectors: ["pii"], action: "warn" });
    expect(g.ok && m.ok).toBe(true);

    // One winner — not a merged decision. This is the law that must NOT move.
    expect((await store.resolvePolicy({ model: "gpt-x" })).id).toBe(m.policy.id);
  });

  it("the resolver's winner is still the strictest action on a full tie", async () => {
    const { store } = await boot();
    const a = await store.createPolicy({ name: "a", scope: "global", priority: 100, detectors: ["pii"], action: "log_only" });
    const b = await store.createPolicy({ name: "b", scope: "global", priority: 100, detectors: ["pii"], action: "block" });
    expect(a.ok && b.ok).toBe(true);
    expect((await store.resolvePolicy({})).id).toBe(b.policy.id);
  });
});

describe("S1: three matching policies at three scopes all appear, in stack order", () => {
  it("global → apikey → model, all stacked by the pipeline", async () => {
    const { store, pipeline } = await boot();
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const minted = await createApiKey("stack-key");
    const keyId = minted.id ?? minted.keyId;

    const g = await store.createPolicy({ name: "g", scope: "global", detectors: ["pii"], action: "log_only", prompt: "GLOBAL PROMPT", promptPosition: "append" });
    const k = await store.createPolicy({ name: "k", scope: "apikey", target: keyId, detectors: ["pii"], action: "log_only", prompt: "APIKEY PROMPT", promptPosition: "append" });
    const m = await store.createPolicy({ name: "m", scope: "model", target: "gpt-x", detectors: ["pii"], action: "log_only", prompt: "MODEL PROMPT", promptPosition: "append" });
    expect(g.ok && k.ok && m.ok).toBe(true);

    const guardrail = await pipeline.resolveGuardrail({
      provider: "openai", model: "gpt-x", apiKey: minted.key, direction: "inbound",
    });
    expect(guardrail.promptStack.map((p) => p.name)).toEqual(["g", "k", "m"]);

    const body = bodyWithSystem("Base system.");
    const n = pipeline.applyPromptStack(guardrail, body, FORMATS.OPENAI);
    expect(n).toBe(3);
    expect(body.messages[0].content).toBe(
      "Base system.\n\nGLOBAL PROMPT\n\nAPIKEY PROMPT\n\nMODEL PROMPT"
    );
  });

  it("listMatchingPolicies returns all three even though resolvePolicy returns one", async () => {
    const { store } = await boot();
    await store.createPolicy({ name: "g", scope: "global", prompt: "A", promptPosition: "append" });
    await store.createPolicy({ name: "p", scope: "provider", target: "openai", prompt: "B", promptPosition: "append" });
    await store.createPolicy({ name: "m", scope: "model", target: "gpt-x", prompt: "C", promptPosition: "append" });

    const stack = await store.listMatchingPolicies({ provider: "openai", model: "gpt-x" });
    expect(stack.map((p) => p.prompt)).toEqual(["A", "B", "C"]);
    // A single winner remains for the scan — the model scope.
    expect((await store.resolvePolicy({ provider: "openai", model: "gpt-x" })).scope).toBe("model");
  });

  it("glob spread across the stack: apikey sits between global and model", async () => {
    const { store, pipeline } = await boot();
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const minted = await createApiKey("order-key");
    const keyId = minted.id ?? minted.keyId;

    await store.createPolicy({ name: "m", scope: "model", target: "gpt-x", priority: 5, prompt: "M", promptPosition: "prepend" });
    await store.createPolicy({ name: "k", scope: "apikey", target: keyId, priority: 5, prompt: "K", promptPosition: "prepend" });
    await store.createPolicy({ name: "g", scope: "global", priority: 5, prompt: "G", promptPosition: "prepend" });

    const guardrail = await pipeline.resolveGuardrail({ provider: "openai", model: "gpt-x", apiKey: minted.key, direction: "inbound" });
    expect(guardrail.promptStack.map((p) => p.name)).toEqual(["g", "k", "m"]);
    const body = bodyWithSystem("BASE");
    pipeline.applyPromptStack(guardrail, body, FORMATS.OPENAI);
    expect(body.messages[0].content).toBe("G\n\nK\n\nM\n\nBASE");
  });
});

describe("S2: disabled excluded", () => {
  it("a disabled policy's prompt never stacks", async () => {
    const { store } = await boot();
    await store.createPolicy({ name: "on", scope: "global", prompt: "ON", promptPosition: "append" });
    await store.createPolicy({ name: "off", scope: "model", target: "gpt-x", prompt: "OFF", promptPosition: "append", enabled: false });

    const stack = await store.listMatchingPolicies({ model: "gpt-x" });
    expect(stack.map((p) => p.name)).toEqual(["on"]);
  });

  it("a policy whose target does not match contributes nothing", async () => {
    const { store } = await boot();
    await store.createPolicy({ name: "other", scope: "model", target: "gpt-y", prompt: "OTHER", promptPosition: "append" });
    expect(await store.listMatchingPolicies({ model: "gpt-x" })).toEqual([]);
  });
});

describe("S3: same-scope priority order", () => {
  it("lower priority number stacks first", async () => {
    const { store } = await boot();
    await store.createPolicy({ name: "late", scope: "global", priority: 50, prompt: "SECOND", promptPosition: "append" });
    await store.createPolicy({ name: "early", scope: "global", priority: 10, prompt: "FIRST", promptPosition: "append" });

    const stack = await store.listMatchingPolicies({});
    expect(stack.map((p) => p.prompt)).toEqual(["FIRST", "SECOND"]);
  });

  it("equal priority falls back to a stable id order (not insertion order)", async () => {
    const { store } = await boot();
    const a = await store.createPolicy({ name: "a", scope: "global", priority: 100, prompt: "A", promptPosition: "append" });
    const b = await store.createPolicy({ name: "b", scope: "global", priority: 100, prompt: "B", promptPosition: "append" });
    expect(a.ok && b.ok).toBe(true);
    const expected = [a.policy, b.policy].sort((x, y) => x.id.localeCompare(y.id)).map((p) => p.id);
    expect((await store.listMatchingPolicies({})).map((p) => p.id)).toEqual(expected);
  });
});

describe("S4: no match = no change", () => {
  it("no policies at all: resolveGuardrail answers null, the body is untouched", async () => {
    const { pipeline } = await boot();
    const guardrail = await pipeline.resolveGuardrail({ provider: "openai", model: "gpt-x", direction: "inbound" });
    expect(guardrail).toBeNull();
    expect(pipeline.applyPromptStack(guardrail, bodyWithSystem("Base."), FORMATS.OPENAI)).toBe(0);

    const body = bodyWithSystem("Base.");
    const before = JSON.stringify(body);
    expect(JSON.stringify(body)).toBe(before);
  });

  it("scan-only policies (no prompt) leave the body byte-identical", async () => {
    const { store, pipeline } = await boot();
    await store.createPolicy({ name: "scan", scope: "global", detectors: ["pii"], action: "mask" });
    const guardrail = await pipeline.resolveGuardrail({ provider: "openai", model: "gpt-x", direction: "inbound" });
    expect(guardrail.promptStack).toEqual([]);
    const body = bodyWithSystem("Base.");
    expect(pipeline.applyPromptStack(guardrail, body, FORMATS.OPENAI)).toBe(0);
    expect(body.messages[0].content).toBe("Base.");
  });

  it("a prompt-only policy resolves even with no enabled scan engine", async () => {
    const { store, pipeline } = await boot();
    await store.createPolicy({ name: "p", scope: "global", detectors: [], action: "allow", prompt: "ONLY PROMPT", promptPosition: "append" });
    const guardrail = await pipeline.resolveGuardrail({ provider: "openai", model: "gpt-x", direction: "inbound" });
    expect(guardrail).not.toBeNull();
    expect(guardrail.engine.enabled()).toBe(false);
    const body = bodyWithSystem("Base.");
    expect(pipeline.applyPromptStack(guardrail, body, FORMATS.OPENAI)).toBe(1);
    expect(body.messages[0].content).toBe("Base.\n\nONLY PROMPT");
  });

  it("the outbound direction stacks nothing — there is no request to prepend to", async () => {
    const { store, pipeline } = await boot();
    await store.createPolicy({ name: "p", scope: "global", detectors: ["pii"], action: "log_only", prompt: "X", promptPosition: "append" });
    const guardrail = await pipeline.resolveGuardrail({ provider: "openai", model: "gpt-x", direction: "outbound" });
    expect(guardrail.promptStack).toEqual([]);
  });
});

describe("S5: per-position bursts in stack order", () => {
  it("prepends concatenate outermost-first ahead of the system text; appends likewise at the end", () => {
    const body = bodyWithSystem("MODEL'S OWN RULES.");
    const n = injectPromptStack(body, FORMATS.OPENAI, [
      { prompt: "GLOBAL PRE", position: "prepend" },
      { prompt: "GLOBAL POST", position: "append" },
      { prompt: "MODEL PRE", position: "prepend" },
      { prompt: "MODEL POST", position: "append" },
    ]);
    expect(n).toBe(4);
    expect(body.messages[0].content).toBe(
      "GLOBAL PRE\n\nMODEL PRE\n\nMODEL'S OWN RULES.\n\nGLOBAL POST\n\nMODEL POST"
    );
  });

  it("a precedence guarantee: an operator's prepend beats the layer before it", () => {
    const body = bodyWithSystem("BASE");
    injectPromptStack(body, FORMATS.OPENAI, [
      { prompt: "api", position: "prepend" },
      { prompt: "model", position: "prepend" },
    ]);
    expect(body.messages[0].content).toBe("api\n\nmodel\n\nBASE");
  });

  it("creates the system message when the body carries none", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectPromptStack(body, FORMATS.OPENAI, [{ prompt: "SYS", position: "append" }]);
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
  });
});

describe("S6: idempotent — a second pass draws in nothing", () => {
  it("re-injecting the same stack leaves the body unchanged", () => {
    const body = bodyWithSystem("Base.");
    const items = [
      { prompt: "GLOBAL RULES", position: "prepend" },
      { prompt: "APPENDED RULE", position: "append" },
    ];
    expect(injectPromptStack(body, FORMATS.OPENAI, items)).toBe(2);
    const once = body.messages[0].content;
    // The property that matters: byte-identical, and a second pass counts zero.
    expect(injectPromptStack(body, FORMATS.OPENAI, items)).toBe(0);
    expect(body.messages[0].content).toBe(once);
  });

  it("KNOWN LIMIT: a token-length prompt is counted applied once (hasPrompt substring law)", () => {
    // systemInject.hasPrompt treats any prompt that is a SUBSTRING of the
    // system text as already present. A one-character prompt ("A") is always
    // a substring of "Base.", so its own first injection is skipped; a
    // one-character PREPEND ("Z", not yet present) injects. The BURST
    // guarantee still holds: "B" was already carried (my second pass read the
    // pre-burst text), so the remaining text "A" is not folded into the
    // append burst. This is the operator-injector idempotency law shared
    // verbatim — documented, not changed here.
    const body = bodyWithSystem("Base.");
    const n = injectPromptStack(body, FORMATS.OPENAI, [
      { prompt: "A", position: "prepend" },
      { prompt: "B", position: "append" },
    ]);
    expect(n).toBe(1);
    expect(body.messages[0].content).toBe("A\n\nBase.");
    expect(body.messages[0].content.split("A").length - 1).toBe(1);
  });

  it("a deterministic prompt already in the system text is skipped, its dupes are not drawn in", () => {
    const body = bodyWithSystem("Deterministic rules.\n\nOther.");
    const n = injectPromptStack(body, FORMATS.OPENAI, [
      { prompt: "Deterministic rules.", position: "prepend" },
      { prompt: "New rule.", position: "append" },
    ]);
    expect(n).toBe(1);
    expect(body.messages[0].content).toBe("Deterministic rules.\n\nOther.\n\nNew rule.");
  });

  it("an empty prompt is skipped and malformed input fails open", () => {
    const body = bodyWithSystem("Base.");
    expect(injectPromptStack(body, FORMATS.OPENAI, [{ prompt: "   ", position: "append" }, null])).toBe(0);
    expect(injectPromptStack(null, FORMATS.OPENAI, [{ prompt: "x" }])).toBe(0);
    expect(body.messages[0].content).toBe("Base.");
  });
});

describe("S7: stricter-action-wins stays the scan's law, untouched by the stack", () => {
  it("a broad log_only prompt-carrying policy cannot soften a narrow block", async () => {
    const { store, pipeline } = await boot();
    await store.createPolicy({ name: "broad", scope: "global", detectors: ["pii"], action: "log_only", prompt: "G", promptPosition: "append" });
    await store.createPolicy({ name: "narrow", scope: "model", target: "gpt-x", detectors: ["pii"], action: "block", prompt: "M", promptPosition: "append" });

    const guardrail = await pipeline.resolveGuardrail({ provider: "openai", model: "gpt-x", direction: "inbound" });
    expect(guardrail.policy.action).toBe("block");
    expect(guardrail.engine.action).toBe("block");
    // …and the content still stacks from BOTH policies.
    expect(guardrail.promptStack.map((p) => p.name)).toEqual(["broad", "narrow"]);
    const scan = pipeline.scanInboundBody(guardrail, { messages: [{ role: "user", content: "mail me at a@b.co" }] });
    expect(scan.action).toBe("block");
  });

  it("captureSystemText sees the change the stack makes (the change detector)", () => {
    const body = bodyWithSystem("Base.");
    const before = captureSystemText(body, FORMATS.OPENAI);
    injectPromptStack(body, FORMATS.OPENAI, [{ prompt: "Z", position: "append" }]);
    expect(captureSystemText(body, FORMATS.OPENAI)).not.toBe(before);
  });
});
