// Termination-contract prompt injector for agentic models prone to looping.
//
// Ported from VansRouter (W3 · sibling-harbor-ports). Two prompts live here:
//   1. TERMINATION_PROMPT — the anti-loop stop condition ("stop calling tools
//      when you have enough; never repeat a tool with the same arguments").
//   2. TOOL_PROTOCOL_PROMPT — the structured-tool-call protocol notice.
//
// Both are injected through Vela's EXISTING system-prompt seam
// (`open-sse/rtk/systemInject.js` → `injectSystemPrompt(body, format, prompt,
// position)`) rather than reimplementing per-format handling here: that seam
// already knows the Claude/Gemini/Kiro/OpenAI-Chat/Responses wire shapes and is
// idempotent, so a double injection cannot duplicate the prompt.
//
// Gating lives with the caller: `needsTerminationPrompt` is the Kimi gate, and
// `TOOL_PROTOCOL_PROMPT_PROVIDERS` the providers that need the tool notice.
import { injectSystemPrompt } from "./systemInject.js";

// Minimal termination contract - no tool names, no over-spec.
// Based on Moonshot/Meritshot research: reward stopping + anti-repetition.
const TERMINATION_PROMPT = `When you have gathered sufficient information to answer the request, STOP calling tools and provide your final answer. Do not call a tool with the same arguments more than once. If a previous attempt returned the same result, change strategy or summarize with available data. Plan briefly (1-3 steps max), then ACT immediately. Do NOT restate your plan — if you have decided what to do, do it now. If you catch yourself repeating the same intention, STOP and give your answer with current knowledge.`;

const TOOL_PROTOCOL_PROMPT = `Tool protocol: call tools only through the structured tool_call mechanism. Use tool names exactly as listed; do not add prefixes, namespaces, dots, or concatenate words. Never invent tool names.`;

// Providers whose models are prone to leaking tool intent into content instead
// of using the structured mechanism (VansRouter's own gate).
const TOOL_PROTOCOL_PROMPT_PROVIDERS = new Set(["kimchi", "nvidia"]);

/**
 * Kimi gate — the only models that receive the termination prompt.
 * Matches a `kimi` path segment (provider or model) or the kimi-k2.6/2.7 line.
 * A non-Kimi model (e.g. Claude) receives nothing.
 */
export function needsTerminationPrompt(provider, model) {
  return /(?:^|[/_-])kimi(?:[/_-]|$)|(?:^|[/_-])kimi-k2\.(?:6|7)(?:\b|[-_/])/i.test(`${provider}/${model}`);
}

/** Inject the anti-loop termination contract into the outgoing body. */
export function injectTerminationPrompt(body, format) {
  injectSystemPrompt(body, format, TERMINATION_PROMPT);
}

/**
 * Inject the structured-tool-call protocol notice, optionally listing the
 * valid tool names (deduped, capped at 80).
 */
export function injectToolProtocolPrompt(body, format, toolNames = []) {
  const names = Array.from(new Set(toolNames.filter(Boolean))).slice(0, 80);
  const prompt = names.length > 0
    ? `${TOOL_PROTOCOL_PROMPT} Valid tool names: ${names.join(", ")}.`
    : TOOL_PROTOCOL_PROMPT;
  injectSystemPrompt(body, format, prompt);
}

export { TERMINATION_PROMPT, TOOL_PROTOCOL_PROMPT };
