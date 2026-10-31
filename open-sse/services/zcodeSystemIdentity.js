// G8 — the official-client identity blocks. The three system blocks the ZCode
// client sends ahead of the caller's own system content are staged verbatim in
// zcode-system-blocks.json (array order is significant: block 0 opens the
// message). This module adds nothing to them — it only reads, strips the
// cache_control the official client does not re-mark on injected copies, and
// answers whether a system payload already carries the official preamble.
//
// Each accessor fails soft: an unreadable or malformed data file yields no
// blocks rather than throwing into the request path.
import blocksJson from "./zcode-system-blocks.json" with { type: "json" };

// ~40 chars of block 0's opening. Its presence in a system payload is the
// idempotence sentinel: if the identity already travelled on a prior pass, a
// second transformRequest must not inject it again.
const IDENTITY_OPENING = "You are ZCode, an interactive coding agent";
// The sentinel is the first 40 characters of that opening (block 0 is 42 chars).
export const ZCODE_IDENTITY_SENTINEL = IDENTITY_OPENING.slice(0, 40);

function sanitizeBlock(block) {
  if (!block || typeof block !== "object") return null;
  const text = typeof block.text === "string" ? block.text : "";
  if (!text) return null;
  // Injected copies carry no cache_control — the official client does not mark
  // its preamble, and a stray marker on a prepended block shifts cache anchors.
  return { type: "text", text };
}

/** The identity blocks, cache_control stripped. [] on any malformed source. */
export function zcodeIdentityBlocks() {
  try {
    if (!Array.isArray(blocksJson)) return [];
    return blocksJson.map(sanitizeBlock).filter(Boolean);
  } catch {
    return [];
  }
}

/** Concatenated block text, in order, with a single blank-line separator. */
export function zcodeIdentityText() {
  return zcodeIdentityBlocks().map((b) => b.text).join("\n\n");
}

// Render a system payload into comparable text: strings pass through, array
// entries contribute their .text (non-text entries contribute nothing —
// they cannot be the preamble).
function systemTextOf(system) {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((entry) => (typeof entry === "string" ? entry : typeof entry?.text === "string" ? entry.text : ""))
      .join("\n\n");
  }
  return "";
}

/** True when the official identity preamble already sits in this system. */
export function hasZcodeIdentity(system) {
  if (system == null) return false;
  const sentinel = ZCODE_IDENTITY_SENTINEL;
  if (!sentinel) return false;
  return systemTextOf(system).includes(sentinel);
}
