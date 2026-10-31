// The Kiro model roster — the single source of truth for this lane's known ids.
//
// Three layers live here, each with one job, so the registry stays a flat list:
//
//   1. KIRO_MODEL_UNION    — the ids this lane advertises (roster = union).
//   2. KIRO_ALIASES        — public spellings that another name has absorbed
//                            (claude-3-5-sonnet → claude-sonnet-5, …). Looked up
//                            BEFORE suffix stripping, so `gpt-5-thinking` may
//                            alias while `claude-3-5-sonnet-thinking` still
//                            carries its thinking intent to the target id.
//   3. KIRO_WIRE_ENUM      — public id → the control-plane enum id KAS/CodeWhisperer
//                            accepts. ONLY the six caidaoli-evidenced pairs + `auto`.
//                            No extrapolation: caidaoli's 3.7/4.0 outliers prove the
//                            family pattern lies, so an unmapped id ships verbatim.
//
// Contract pinned by tests/unit/kiro-model-roster.test.js.

export const KIRO_VARIANT_SUFFIXES = ["-thinking-agentic", "-thinking", "-agentic"];

/**
 * Split Vela's synthetic variant suffixes off a public id.
 * Returns the base id and which variants were named.
 */
export function splitKiroVariantSuffix(id) {
  const model = String(id ?? "").trim();
  let base = model;
  const thinking = base.endsWith("-thinking") || base.endsWith("-thinking-agentic");
  const agentic = base.endsWith("-agentic");
  if (thinking) base = base.slice(0, -"-thinking".length);
  if (agentic) base = base.slice(0, -"-agentic".length);
  return { base, thinking, agentic };
}

/**
 * Public-spelling aliases (C2). Values are PUBLIC ids, not wire enum ids — the
 * alias hop and the enum hop are separate, and mapping-before-suffix-strip
 * means an alias can itself carry a `-thinking` / `-agentic` tail.
 */
export const KIRO_ALIASES = Object.freeze({
  // tanu360 alias table (the five named in the sealed plan)
  "claude-3-5-sonnet": "claude-sonnet-5",
  "claude-3-5-sonnet-20241022": "claude-sonnet-5",
  "gpt-5": "claude-opus-5",
  "gpt-5.5": "claude-opus-4.8",
  "claude-opus-4": "claude-opus-4.5",
  // Beyond the plan's named five: only DASH-versus-DOT spellings of an id that
  // is already in the roster (same model, different punctuation), so every one
  // of these is also reached by normalizeKiroVersion(). Nothing here maps one
  // generation onto another.
  "claude-sonnet-4-5": "claude-sonnet-4.5",
  "claude-sonnet-4.5-20250929": "claude-sonnet-4.5",
  "claude-opus-4-5": "claude-opus-4.5",
  "claude-haiku-4-5": "claude-haiku-4.5",
});

/**
 * The version-normalization regex (C2): a digit–hyphen–digit run in an id is a
 * dash spelling of a dotted version (`claude-3-5-sonnet` → `claude-3.5-sonnet`,
 * `claude-sonnet-4-5` → `claude-sonnet-4.5`). Applied to a LOOKUP KEY only —
 * never to the id that goes on the wire.
 */
export const KIRO_VERSION_NORMALIZE_RE = /(\d)-(\d)/g;

export function normalizeKiroVersion(id) {
  return String(id ?? "").replace(KIRO_VERSION_NORMALIZE_RE, "$1.$2");
}

/**
 * The wire enum map (C1). The six caidaoli-evidenced public ids + `auto`.
 * Anything else — including every non-Anthropic id, every alias target, and
 * every future id — passes through verbatim to the upstream.
 */
export const KIRO_WIRE_ENUM = Object.freeze({
  "claude-opus-4.5": "CLAUDE_OPUS_4_5_V1_0",
  "claude-sonnet-4.5": "CLAUDE_SONNET_4_5_V1_0",
  "claude-haiku-4.5": "CLAUDE_HAIKU_4_5_V1_0",
  "claude-opus-5": "CLAUDE_OPUS_5_V1_0",
  "claude-sonnet-5": "CLAUDE_SONNET_5_V1_0",
  "claude-haiku-5.5": "CLAUDE_HAIKU_5_5_V1_0",
  auto: "auto",
});

/** The three ids C2 adds to the roster (none is in the enum map: they ride `auto`). */
export const KIRO_UNION_ADDITIONS = Object.freeze([
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-haiku-20241022",
]);

/**
 * Resolve a public id (with any synthetic suffix) to its wire model id.
 *
 * Order is the law: ENUM FIRST on the full id (auto), then ALIAS, then
 * suffix SPLIT, then ENUM on the base, then verbatim. An unmapped id is never
 * guessed — it leaves exactly as it arrived.
 *
 * @returns {{ wire: string, base: string, thinking: boolean, agentic: boolean, aliased: boolean, enumMapped: boolean }}
 */
export function resolveKiroWireModel(id) {
  const publicId = String(id ?? "").trim();

  // 1. The full id is itself an enum key (`auto` — the only such case today).
  if (Object.hasOwn(KIRO_WIRE_ENUM, publicId)) {
    return { wire: KIRO_WIRE_ENUM[publicId], base: publicId, thinking: false, agentic: false, aliased: false, enumMapped: true };
  }

  // 2. Split the synthetic variants, then ALIAS on the base — the hop runs
  //    before the enum lookup, so `claude-3-5-sonnet-thinking` means "thinking,
  //    on claude-sonnet-5" instead of a verbatim miss.
  const split = splitKiroVariantSuffix(publicId);
  const aliasOf = (key) => KIRO_ALIASES[key] ?? KIRO_ALIASES[normalizeKiroVersion(key)];
  const direct = aliasOf(split.base);
  // 3. An alias spelled WITH its variants (`gpt-5-thinking`, `claude-3-5-sonnet-agentic`):
  //    the whole-id entry wins, then its target's variants are honoured.
  const full = direct ? null : aliasOf(publicId);
  const target = splitKiroVariantSuffix(direct ?? full ?? split.base);
  // A whole-id alias (`claude-consolidated-4-5`: the whole spelling, variants
  // included, IS the alias key) renames the base and keeps ITS variants; an
  // alias on the split base keeps the caller's own suffix flags.
  const wholeHit = !direct && Boolean(full);

  const thinking = wholeHit ? target.thinking : (split.thinking || target.thinking);
  const agentic = wholeHit ? target.agentic : (split.agentic || target.agentic);
  const base = target.base;
  const enumId = KIRO_WIRE_ENUM[base];

  return {
    // 4. ENUM on the base (the six evidenced ids); else the id verbatim.
    //    Only an IDENTITY holding an enum id may receive the split flags
    //    (CLAUDE_*_V1_0); every other id ships exactly as it arrived, so an
    //    unmapped model is never guessed and never re-spelled.
    wire: enumId ?? publicId,
    base,
    thinking,
    agentic,
    aliased: Boolean(direct || full),
    enumMapped: Boolean(enumId),
  };
}

/**
 * The extra registry tail for a variant of a mapped base, so a newly added
 * roster entry (e.g. `claude-opus-4.5-agentic`) still resolves to its eval id.
 * Identity when nothing changed.
 */
export function kiroUpstreamModelIdFor(publicId) {
  const { wire } = resolveKiroWireModel(publicId);
  return wire === publicId ? undefined : wire;
}

/** Variant expansion used by the registry rows for the union additions. */
export function kiroUnionVariantIds(baseId) {
  return [baseId, `${baseId}-thinking`, `${baseId}-agentic`, `${baseId}-thinking-agentic`];
}

/** Display name for a union addition (only the ones the union adds). */
export function kiroUnionDisplayName(baseId) {
  const names = {
    "claude-sonnet-4-20250514": "Claude Sonnet 4 (2025-05-14)",
    "claude-3-7-sonnet-20250219": "Claude 3.7 Sonnet (2025-02-19)",
    "claude-3-5-haiku-20241022": "Claude 3.5 Haiku (2024-10-22)",
  };
  return names[baseId] || baseId;
}

