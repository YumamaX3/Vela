// LogFilterBar — §7's filter chips, one bar over all three streams.
//
// Seven chips: stream · level (numeric `>=`) · provider · tag · time range
// (since/until) · free text (`q`) · upstreamId. Each one maps to exactly one
// §6 selector parameter, and the chip does no filtering of its own: it sends
// the param, and the door validates, escapes, and narrows (§6's two-tier `q`
// law is a SERVER law — a chip that filtered locally would be a second,
// divergent implementation of the same idea).
//
// ── THE `q` LAW, STATED IN THE UI ───────────────────────────────────────────
// §6 refuses a `q` that is not carried by a narrowing selector, and refuses
// credential-shaped substrings outright (a free-text oracle over
// best-effort-redacted rows is a secret-search oracle). The door answers
// `qHonoured` / `qIgnoredBecauseUnnarrowed`, and this bar renders that answer
// verbatim rather than pretending the term applied. A filter that silently
// stops applying is the same silent-lie class the 400 laws exist to kill.
//
// ── SAVED FILTERS ───────────────────────────────────────────────────────────
// localStorage under `vela_log_filters` (the house's `vela_`-prefixed naming,
// Sidebar.js's `vela_update_dismissed` precedent). A private-mode quota throw
// costs the operator their saved set, never the room — every access is
// guarded and the tail still works without it.
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";
import { LEVELS, levelName } from "./LogRow";

/** §1's three declared streams. */
export const STREAM_CHIPS = Object.freeze(["console", "container", "request"]);

/** The house's `vela_`-prefixed localStorage namespace. */
export const FILTERS_STORAGE_KEY = "vela_log_filters";

/** Time presets, in ms. Named ranges, not free dates — an operator triaging a
 *  live incident asks "the last fifteen minutes", not "since 09:41". */
const RANGES = Object.freeze([
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60_000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 60 * 60_000 },
]);

/** A filter is empty when no chip constrains it. */
export function isEmptyFilter(f) {
  return !f || (!f.stream && !f.minLvl && !f.provider && !f.tag && !f.range && !f.q && !f.upstreamId);
}

/** Read the saved filter set. Malformed storage is discarded, never fatal. */
function readSaved() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f) => f && typeof f === "object" && typeof f.name === "string").slice(0, 12);
  } catch {
    return [];
  }
}

function writeSaved(list) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* private mode — the harbor still filters, it just forgets */
  }
}

/**
 * Translate the chip state into §6's query parameters.
 *
 * The `since` value is derived from the RANGE chip at the moment of the call,
 * not stored: a stored `since` would be a timestamp frozen at save time, and
 * a re-applied saved filter would then silently return an ever-shrinking
 * window. A re-applied range is re-anchored to NOW, which is what "last 15
 * minutes" means every time it is read.
 *
 * @param {object} filter
 * @param {number} [nowMs]
 * @returns {URLSearchParams}
 */
export function filterToParams(filter, nowMs = Date.now()) {
  const params = new URLSearchParams();
  if (filter?.stream) params.set("stream", filter.stream);
  if (filter?.minLvl) params.set("minLvl", String(filter.minLvl));
  if (filter?.provider) params.set("provider", filter.provider);
  if (filter?.tag) params.set("tag", filter.tag);
  if (filter?.q) params.set("q", filter.q);
  if (filter?.upstreamId) params.set("upstreamId", filter.upstreamId);
  const range = RANGES.find((r) => r.id === filter?.range);
  if (range) params.set("since", String(nowMs - range.ms));
  return params;
}

export default function LogFilterBar({
  filter,
  onChange,
  qHonoured = null,
  qIgnoredBecauseUnnarrowed = false,
  filterError = null,
  rowCount = null,
  saved = [],
  onSavedChange,
  facets = { providers: [], tags: [] },
}) {
  const [saveName, setSaveName] = useState("");
  const [qDraft, setQDraft] = useState(filter?.q ?? "");

  // The draft only overwrites the committed filter on an explicit apply, so a
  // keystroke does not fire a query per character against a 200k table.
  useEffect(() => {
    setQDraft(filter?.q ?? "");
  }, [filter?.q]);

  const set = useCallback(
    (patch) => onChange({ ...filter, ...patch }),
    [filter, onChange]
  );

  // The two-tier law, computed the same way the door computes it: `q` needs a
  // selector that already narrowed. Mirrored here ONLY to warn the operator
  // early; the door is still the authority on what it honours.
  const narrowed =
    Boolean(filter?.stream) ||
    Boolean(filter?.minLvl) ||
    Boolean(filter?.provider) ||
    Boolean(filter?.tag) ||
    Boolean(filter?.upstreamId) ||
    Boolean(filter?.range);

  const qInert = Boolean(qDraft.trim()) && !narrowed;

  const applyQ = useCallback(() => {
    const next = qDraft.trim();
    set(next === (filter?.q ?? "") ? {} : { q: next || undefined });
  }, [qDraft, filter?.q, set]);

  const saveCurrent = useCallback(() => {
    const name = saveName.trim();
    if (!name || typeof onSavedChange !== "function") return;
    onSavedChange([...saved.filter((f) => f.name !== name), { name, filter: { ...filter } }]);
    setSaveName("");
  }, [saveName, filter, saved, onSavedChange]);

  const removeSaved = useCallback(
    (name) => {
      if (typeof onSavedChange === "function") onSavedChange(saved.filter((f) => f.name !== name));
    },
    [saved, onSavedChange]
  );

  const chip = "inline-flex min-h-[28px] items-center gap-1.5 rounded-[8px] border px-2.5 text-2xs font-semibold motion-control";
  const chipOn = "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300";
  const chipOff = "border-border-strong bg-surface-2 text-text-muted hover:text-text-main";

  const activeCount = useMemo(
    () =>
      ["stream", "minLvl", "provider", "tag", "range", "q", "upstreamId"].filter((k) => filter?.[k]).length,
    [filter]
  );

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-border-subtle bg-surface p-3 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
          {translate("Stream")}
        </span>
        {STREAM_CHIPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set({ stream: filter.stream === s ? undefined : s })}
            aria-pressed={filter.stream === s}
            className={cn(chip, filter.stream === s ? chipOn : chipOff)}
          >
            {s}
          </button>
        ))}

        <span className="ml-2 mr-1 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
          {translate("Level")}
        </span>
        {LEVELS.map((l) => (
          <button
            key={l.num}
            type="button"
            onClick={() => set({ minLvl: filter.minLvl === l.num ? undefined : l.num })}
            aria-pressed={filter.minLvl === l.num}
            title={translate(`Level >= ${levelName(l.num)}`)}
            className={cn(chip, filter.minLvl === l.num ? chipOn : chipOff)}
          >
            {levelName(l.num)}+
          </button>
        ))}

        <span className="ml-2 mr-1 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
          {translate("Window")}
        </span>
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => set({ range: filter.range === r.id ? undefined : r.id })}
            aria-pressed={filter.range === r.id}
            className={cn(chip, filter.range === r.id ? chipOn : chipOff)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Provider — a facet list from the rows already on screen, so the chip
            never invents a value the ledger has never held. */}
        <label className="inline-flex items-center gap-1.5 text-2xs text-text-subtle">
          {translate("Provider")}
          <select
            value={filter.provider ?? ""}
            onChange={(e) => set({ provider: e.target.value || undefined })}
            aria-label={translate("Provider")}
            className="h-7 min-h-[28px] rounded-[8px] border border-border-strong bg-surface-2 px-2 font-mono text-2xs text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">{translate("Any")}</option>
            {facets.providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-1.5 text-2xs text-text-subtle">
          {translate("Tag")}
          <select
            value={filter.tag ?? ""}
            onChange={(e) => set({ tag: e.target.value || undefined })}
            aria-label={translate("Tag")}
            className="h-7 min-h-[28px] rounded-[8px] border border-border-strong bg-surface-2 px-2 font-mono text-2xs text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">{translate("Any")}</option>
            {facets.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div className="relative min-w-[200px] flex-1">
          <span
            aria-hidden="true"
            className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-text-subtle"
          >
            search
          </span>
          <input
            type="text"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyQ();
              }
            }}
            aria-label={translate("Free text over messages")}
            placeholder={translate("Free text (Enter to apply)")}
            className={cn(
              "h-8 w-full rounded-[8px] border bg-surface-2 pl-8 pr-2.5 font-mono text-xs text-text-main placeholder:font-sans placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30",
              qInert ? "border-amber-500/60" : "border-border-strong focus:border-brand-500/60"
            )}
          />
        </div>

        {activeCount > 0 && (
          <Button size="sm" variant="ghost" icon="filter_alt_off" onClick={() => set({ stream: undefined, minLvl: undefined, provider: undefined, tag: undefined, range: undefined, q: undefined, upstreamId: undefined })}>
            {translate("Clear")}
          </Button>
        )}
        {rowCount !== null && (
          <span className="font-mono text-2xs tabular-nums text-text-muted">
            {rowCount} {translate("rows")}
          </span>
        )}
      </div>

      {/* The door's own verdict, rendered verbatim. */}
      {filterError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {translate("The harbor refused this filter")}:{" "}
          <span className="font-mono">{filterError}</span>
        </p>
      )}
      {qIgnoredBecauseUnnarrowed && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {translate("Free text is ignored until a stream, level, provider, tag, or window narrows the tail — a word search across the whole ledger is refused by design.")}
        </p>
      )}
      {qInert && qDraft.trim() !== (filter?.q ?? "") && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {translate("Narrow first, then the word search will apply.")}
        </p>
      )}
      {qHonoured === false && !qIgnoredBecauseUnnarrowed && (
        <p className="text-xs text-text-muted">{translate("The door did not honour the free-text term.")}</p>
      )}

      {/* ── Saved filters ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
        <span className="mr-1 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
          {translate("Saved")}
        </span>
        {saved.map((s) => (
          <span key={s.name} className="inline-flex items-center overflow-hidden rounded-[8px] border border-border-strong bg-surface-2">
            <button
              type="button"
              onClick={() => onChange({ ...s.filter })}
              className="px-2 py-0.5 font-mono text-2xs text-text-muted hover:text-text-main"
            >
              {s.name}
            </button>
            <button
              type="button"
              onClick={() => removeSaved(s.name)}
              aria-label={translate(`Remove saved filter ${s.name}`)}
              className="border-l border-border-strong px-1.5 py-0.5 text-2xs text-text-subtle hover:text-red-600 dark:hover:text-red-400"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveCurrent();
            }
          }}
          aria-label={translate("Name this filter")}
          placeholder={translate("Name and save")}
          className="h-7 min-h-[28px] w-[140px] rounded-[8px] border border-border-strong bg-surface-2 px-2 text-2xs text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <Button size="sm" variant="outline" icon="bookmark_add" onClick={saveCurrent} disabled={!saveName.trim()}>
          {translate("Save")}
        </Button>
      </div>
    </div>
  );
}