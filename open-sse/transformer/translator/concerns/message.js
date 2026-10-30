import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array. A TEXT-ONLY array flattens to a single
// joined string (some OpenAI-compatible providers reject array content outright,
// and a text-only array carries no structure worth keeping); anything else —
// images, tool parts, mixed — is returned as-is. A lone text part is the
// one-element case of the same rule, so its behavior is unchanged.
export function collapseTextParts(parts) {
  if (parts.length === 0) return parts;
  // C1-drift mend (2026-10-11, #2069 regression): a block carrying
  // cache_control IS structure — the marker only exists on array parts, and
  // the preserveCacheControl quirk (alicode/DashScope) exists precisely to
  // keep it. Flattening a text-only array silently destroyed the preserved
  // marker. A text-only array where NO part carries a marker still collapses.
  if (parts.every((part) => part?.type === OPENAI_BLOCK.TEXT && !part?.cache_control)) {
    return parts.map((part) => part.text ?? "").join("\n");
  }
  return parts;
}
