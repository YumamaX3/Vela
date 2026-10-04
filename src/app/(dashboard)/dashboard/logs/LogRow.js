// LogRow — §7's ONE-RENDERING LAW, in one component.
//
// §1 requires that "the unified tail renders persisted-shaped (scrubbed) rows
// for BOTH live and queried lines — one rendering, both sources". The SSE door
// already shapes its live frames with `toLiveRow` to the persisted field set
// (`id: null` because the worker assigns the real row id), so the tail can hand
// a live frame and a queried row to this component without asking which is
// which. Two renderers for two sources is how the two shapes drift apart
// forever; this file exists to make that impossible.
//
// ── THE RENDERING LAW (TEXT ONLY) ───────────────────────────────────────────
// §7: "no component in the Log Harbor may use dangerouslySetInnerHTML (or any
// raw-HTML viewer)". An upstream error body must never become stored XSS
// against the operator's own session. So every value below is placed in JSX
// as a CHILD — React escapes it, and a message carrying
// `<script>alert(1)</script>` becomes a text node, never an element. There is
// no `dangerouslySetInnerHTML`, no `innerHTML`, no `insertAdjacentHTML`, no
// `document.write` anywhere in this file, and tests/unit/log-render-law.test.js
// greps the whole harbor to keep it that way.
//
// The ANSI handling in AnsiText is the same law applied to the raw container
// tab: SGR sequences are PARSED into styled React spans, never written as
// markup. `\u001b[31m` becomes a `<span class="text-red-400">`, and the
// characters between the codes are still ordinary escaped children.
"use client";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";

/** §1's five numeric levels, ascending. `minLvl` compares against these. */
export const LEVELS = Object.freeze([
  { num: 10, name: "DEBUG" },
  { num: 20, name: "INFO" },
  { num: 30, name: "WARN" },
  { num: 40, name: "ERROR" },
  { num: 50, name: "FATAL" },
]);

/**
 * Level → the house's own terminal hues. These are the classes ConsoleStream
 * already measured on the terminal ground (#0B1E33): emerald 8.75:1 · sky
 * 7.86:1 · amber 11.67:1 · red 6.08:1 · violet 9.12:1 — all clear of SC 1.4.3.
 * Re-declared here rather than imported from ConsoleStream because that file's
 * copy is keyed by the console ring's own LOG/INFO/… vocabulary, and §1's
 * enum is numeric — importing it would put a translation table between the row
 * and its level.
 */
const LEVEL_TONE = Object.freeze({
  10: { term: "text-violet-300", hud: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  20: { term: "text-sky-400", hud: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  30: { term: "text-amber-300", hud: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  40: { term: "text-red-400", hud: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300" },
  50: { term: "text-red-300", hud: "border-red-600/60 bg-red-600/10 text-red-800 dark:text-red-200" },
});

/** Unknown numeric levels degrade to INFO's tone rather than painting nothing. */
export function levelTone(lvl) {
  return LEVEL_TONE[Number(lvl)] || LEVEL_TONE[20];
}

/** The display name for a numeric level; unknown numbers are shown as-is. */
export function levelName(lvl) {
  const n = Number(lvl);
  return LEVELS.find((l) => l.num === n)?.name || String(n);
}

/**
 * The row's React key. A PERSISTED row has a real `id`; a LIVE frame does not
 * (the worker assigns the row id later), so M7 hands the client `(ts, seq)`
 * for those. Both halves are named here so no call site re-derives them — a
 * key of `undefined` for a thousand live rows is the bug this prevents.
 */
export function rowKey(row) {
  if (row?.id !== null && row?.id !== undefined) return `p${row.id}`;
  return `l${row?.ts ?? 0}:${row?.seq ?? 0}`;
}

/** `2026-10-04 09:41:22.481` in LOCAL time, from epoch ms. */
export function formatRowTime(ts) {
  const d = new Date(Number(ts) || 0);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (v, n = 2) => String(v).padStart(n, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** The clock fraction alone — what a 200px-wide tail column can fit. */
export function formatRowClock(ts) {
  const d = new Date(Number(ts) || 0);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (v) => String(v).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Pretty-print a `meta` blob as TEXT for the inspector.
 *
 * The column is nullable TEXT in §1: the write door stores whatever
 * `shipLog` serialized, which is JSON when it could stringify and a bare
 * string when it could not. So this tries JSON and falls back to the raw
 * text — and it NEVER throws on a malformed blob, because a corrupt meta
 * must not take the drawer down with it.
 */
export function formatMeta(meta) {
  if (meta === null || meta === undefined || meta === "") return null;
  if (typeof meta === "object") {
    try {
      return JSON.stringify(meta, null, 2);
    } catch {
      return String(meta);
    }
  }
  try {
    return JSON.stringify(JSON.parse(String(meta)), null, 2);
  } catch {
    return String(meta);
  }
}

// ── ANSI → styled spans (raw container tab only) ────────────────────────────

/**
 * SGR parameters → the house's terminal classes.
 *
 * Only the subset a process actually prints is mapped. An unmapped code falls
 * back to `null`, which `ansiToSegments` renders as "end the current span"
 * rather than guessing a colour — guessing is how a raw view starts lying
 * about what the process printed.
 */
const SGR_CLASS = Object.freeze({
  1: "font-semibold",
  2: "opacity-70",
  3: "italic",
  4: "underline",
  30: "text-slate-400",
  31: "text-red-400",
  32: "text-emerald-400",
  33: "text-amber-300",
  34: "text-sky-400",
  35: "text-violet-300",
  36: "text-cyan-300",
  37: "text-slate-100",
  90: "text-slate-500",
  91: "text-red-300",
  92: "text-emerald-300",
  93: "text-amber-200",
  94: "text-sky-300",
  95: "text-violet-200",
  96: "text-cyan-200",
});

/**
 * Split one raw line into `{text, className}` segments.
 *
 * THE LAW: this is a PARSER, not a formatter. Every escape sequence becomes a
 * boundary between two ordinary strings; nothing upstream ever reaches the DOM
 * as markup. A non-SGR sequence (CSI, OSC) is dropped the same way the write
 * door drops it — a raw view may lose a hyperlink, never gain an injection.
 *
 * @param {string} line
 * @returns {Array<{text: string, className: string|null}>}
 */
export function ansiToSegments(line) {
  const text = String(line ?? "");
  // OSC (ESC ] … BEL/ST) first: it can contain an SGR-looking payload, and the
  // SGR regex alone would happily match inside it.
  const withoutOsc = text.replace(/\][^]*(?:|\\)?/g, "");
  const pattern = /\[([0-9;]*)m/g;
  const segments = [];
  let className = null;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(withoutOsc)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: withoutOsc.slice(cursor, match.index), className });
    }
    const codes = match[1].split(";").filter((c) => c !== "").map(Number);
    const codes_ = codes.length ? codes : [0];
    if (codes_.includes(0)) {
      className = null;
    } else {
      const classes = codes_.map((c) => SGR_CLASS[c]).filter(Boolean);
      className = classes.length ? classes.join(" ") : className;
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < withoutOsc.length) {
    segments.push({ text: withoutOsc.slice(cursor), className });
  }
  return segments.length ? segments : [{ text: "", className: null }];
}

/** AnsiText — the raw view's renderer. Spans, never markup. */
export function AnsiText({ line, className }) {
  const segments = ansiToSegments(line);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.className ? (
          <span key={i} className={seg.className}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

/**
 * One persisted-shaped row, rendered once for every source.
 *
 * @param {object} props
 * @param {object} props.row       - a `toWireRow` row or an SSE `toLiveRow` frame.
 * @param {boolean} [props.selected] - the j/k cursor's row.
 * @param {number}  [props.index]  - absolute index, for the aria position.
 * @param {number}  [props.total]  - absolute count, for the aria position.
 * @param {fn}      [props.onSelect]
 * @param {fn}      [props.onOpen]  - open the voyage / inspector.
 * @param {number}  [props.rowHeight]
 * @param {boolean} [props.raw]    - render msg through the ANSI parser.
 */
export default function LogRow({
  row,
  selected = false,
  index = 0,
  total = 0,
  onSelect,
  onOpen,
  rowHeight,
  raw = false,
}) {
  const tone = levelTone(row?.lvl);
  const name = levelName(row?.lvl);
  const clock = formatRowClock(row?.ts);
  const joinable = Boolean(row?.reqId);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(row)}
      onDoubleClick={() => onOpen?.(row)}
      aria-selected={selected}
      aria-posinset={total ? index + 1 : undefined}
      aria-setsize={total || undefined}
      data-row-key={rowKey(row)}
      data-level={name}
      style={rowHeight ? { height: rowHeight } : undefined}
      className={cn(
        "flex w-full items-center gap-2 border-l-2 px-2 text-left font-mono text-xs motion-control",
        // A row that grows past its fixed height would break the window's
        // arithmetic (index * ROW_HEIGHT), so the content is clipped, not
        // wrapped. The inspector drawer is where a long message is read whole.
        "overflow-hidden whitespace-pre",
        row?.lvl >= 40 ? "border-l-red-500/60" : row?.lvl >= 30 ? "border-l-amber-500/60" : "border-l-transparent",
        selected ? "bg-brand-500/15 ring-1 ring-inset ring-brand-500/50" : "hover:bg-white/5 focus-visible:bg-white/5"
      )}
    >
      <span
        aria-hidden="true"
        className="w-[62px] shrink-0 select-none tabular-nums text-[var(--color-terminal-text)]/55"
      >
        {clock}
      </span>
      <span className={cn("w-[46px] shrink-0 font-semibold", tone.term)}>{name}</span>
      <span className="w-[74px] shrink-0 truncate text-[var(--color-terminal-text)]/55">{row?.stream || "—"}</span>
      {row?.tag ? (
        <span className="w-[92px] shrink-0 truncate text-[var(--color-terminal-text)]/50">[{row.tag}]</span>
      ) : (
        <span className="w-[92px] shrink-0 text-[var(--color-terminal-text)]/20">·</span>
      )}
      {row?.provider ? (
        <span className="w-[84px] shrink-0 truncate text-[var(--color-terminal-text)]/60">{row.provider}</span>
      ) : (
        <span className="w-[84px] shrink-0 text-[var(--color-terminal-text)]/20">·</span>
      )}
      <span className="min-w-0 flex-1 truncate text-[var(--color-terminal-text)]/85">
        {raw ? (
          <AnsiText line={row?.msg} />
        ) : (
          // The plain text child. §1's control-char law already made this
          // print-safe; React's escaping is what makes it INERT.
          row?.msg ?? ""
        )}
        {row?.truncMsg ? (
          <span className="ml-1 text-amber-300/80" title={translate("Clamped at the write door")}>
            ⟂
          </span>
        ) : null}
      </span>
      {/* The voyage affordance. §7 joins on `reqId` ONLY: a row with no reqId
          is unjoinable and says so rather than inviting a click that can only
          come back empty. */}
      <span
        className={cn(
          "w-[104px] shrink-0 truncate text-2xs",
          joinable ? "text-brand-300/80" : "text-[var(--color-terminal-text)]/30"
        )}
        title={joinable ? row.reqId : translate("Unjoinable — this line carries no reqId")}
      >
        {joinable ? row.reqId : translate("unjoinable")}
      </span>
    </button>
  );
}