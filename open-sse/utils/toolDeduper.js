/**
 * Strip built-in/duplicate tools when equivalent MCP tools are present.
 * Goal: reduce tool definitions token bloat for Claude clients.
 *
 * tool_reference cleanup (upstream a3039ab1): history refs naming a stripped
 * tool are replaced, so strict Claude-compatible upstreams don't reject the request.
 */
import { CLAUDE_BLOCK } from "../transformer/translator/schema/blocks.js";

const DEDUP_RULES = [
  {
    // Exa MCP present → drop built-in web tools (Exa is preferred).
    triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Tavily MCP present → drop built-in web tools.
    triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Browser MCP present → drop Cowork's duplicate Claude_in_Chrome connector.
    triggers: [/^mcp__browsermcp__/],
    strip: [/^mcp__Claude_in_Chrome__/],
  },
];

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function matches(name, pattern) {
  if (typeof pattern === "string") return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

// Claude Code's deferred tool loading returns `tool_reference` blocks inside a
// tool_result. When dedup strips a tool the model already loaded, a surviving
// reference names a tool no longer in the request — strict Claude-compatible
// upstreams reject the whole request over it (z.ai 400 code 1210, verified live
// 2026-11-08). Remove such references; if nothing remains, leave a text note —
// an empty content array is itself invalid — so the model knows the tool is gone
// and falls back to the MCP equivalent that replaced it.
function cleanStrippedToolReferences(messages, strippedNames) {
  if (!Array.isArray(messages) || strippedNames.size === 0) return 0;
  let cleaned = 0;
  for (const msg of messages) {
    const content = msg?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== CLAUDE_BLOCK.TOOL_RESULT || !Array.isArray(block.content)) continue;
      const removed = block.content.filter(
        (p) => p?.type === CLAUDE_BLOCK.TOOL_REFERENCE && strippedNames.has(p.tool_name)
      );
      if (removed.length === 0) continue;
      cleaned += removed.length;
      const kept = block.content.filter((p) => !removed.includes(p));
      block.content = kept.length
        ? kept
        : [{ type: CLAUDE_BLOCK.TEXT, text: removed.map((p) => `[Tool ${p.tool_name} is unavailable]`).join("\n") }];
    }
  }
  return cleaned;
}

function dedupeTools(tools, opts = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] };
  const names = tools.map(getToolName);
  const toStrip = new Set();
  for (const rule of DEDUP_RULES) {
    const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
    if (!hasTrigger) continue;
    for (const n of names) {
      if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
    }
  }
  if (toStrip.size === 0) return { tools, stripped: [] };
  cleanStrippedToolReferences(opts.messages, toStrip);
  const out = tools.filter((t) => !toStrip.has(getToolName(t)));
  return { tools: out, stripped: Array.from(toStrip) };
}

export { dedupeTools };
