"use client";

// Console Log — the gateway's own stdout, re-cut as a telemetry deck.
//
// The server buffer (src/lib/consoleLogBuffer.js) stamps every captured line
// with an arrival time and level, and now also publishes structured entries
// over the same SSE channel. This deck renders those entries: a live HUD of
// level counts and top tags, a rate meter, and a terminal pane whose rows
// open a full-entry inspector. Raw mode still shows the untouched line.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";

const LEVELS = ["LOG", "INFO", "WARN", "ERROR", "DEBUG"];

// Two colour sets on purpose: `term` sits on the warm ink terminal panel,
// `hud` sits on a surface card in either theme. The light-theme HUD chips
// use the 700 step and the dark-theme chips the 300 step, so both keep
// >= 4.5:1 against their own background.
const LEVEL_META = {
  LOG: {
    term: "text-emerald-400",
    accent: "border-l-emerald-500/50",
    hudOn: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  INFO: {
    term: "text-sky-400",
    accent: "border-l-sky-500/50",
    hudOn: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  WARN: {
    term: "text-amber-300",
    accent: "border-l-amber-500/60",
    hudOn: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  ERROR: {
    term: "text-red-400",
    accent: "border-l-red-500/60",
    hudOn: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  DEBUG: {
    term: "text-violet-300",
    accent: "border-l-violet-500/50",
    hudOn: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
};

const RATE_SECONDS = 30;

function metaFor(level) {
  return LEVEL_META[level] || LEVEL_META.LOG;
}

// The captured message already carries its own leading [TAG] tokens, and the
// deck renders those tags separately. Strip the leading run so the body is not
// double-tagged; a message that is nothing but tags keeps its original text.
function bodyOf(message) {
  const stripped = String(message).replace(/^(\s*\[[A-Za-z0-9_-]{2,24}\])+/, "").trimStart();
  return stripped || message;
}

function buildMatcher(query, useRegex) {
  const q = query.trim();
  if (!q) return { test: () => true, error: null };
  if (!useRegex) {
    const lower = q.toLowerCase();
    return { test: (entry) => entry.message.toLowerCase().includes(lower) || entry.time.includes(lower), error: null };
  }
  try {
    const re = new RegExp(q, "i");
    return { test: (entry) => re.test(entry.message) || re.test(entry.time), error: null };
  } catch (err) {
    return { test: () => false, error: err.message };
  }
}

export default function ConsoleLogClient() {
  const [entries, setEntries] = useState([]);
  const [connected, setConnected] = useState(false);
  const [activeLevels, setActiveLevels] = useState(() => new Set(LEVELS));
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [tagFilter, setTagFilter] = useState(null);
  const [view, setView] = useState("structured");
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [armedClear, setArmedClear] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const logRef = useRef(null);
  const searchRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const disarmTimerRef = useRef(null);

  const maxLines = CONSOLE_LOG_CONFIG.maxLines;

  // ── Stream ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream?structured=true");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "init") {
        setEntries(Array.isArray(msg.logs) ? msg.logs.slice(-maxLines) : []);
      } else if (msg.type === "entries") {
        setEntries((prev) => {
          const next = prev.length ? [...prev, ...msg.entries] : msg.entries;
          return next.length > maxLines ? next.slice(-maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setEntries([]);
        setSelectedId(null);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [maxLines]);

  // Ages the rate buckets even when no line arrives.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Follow the tail only while the reader is at the bottom.
  useEffect(() => {
    if (follow && stickToBottomRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries, follow, view, wrap]);

  const handleScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, []);

  // `/` focuses search from anywhere on the deck.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => clearTimeout(disarmTimerRef.current), []);

  // ── Derived telemetry ────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const out = { total: entries.length, LOG: 0, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
    for (const e of entries) {
      if (out[e.level] !== undefined) out[e.level] += 1;
    }
    return out;
  }, [entries]);

  const tagCounts = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      for (const t of e.tags || []) map.set(t, (map.get(t) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries]);

  const topTags = useMemo(() => tagCounts.slice(0, 10), [tagCounts]);

  const matcher = useMemo(() => buildMatcher(query, useRegex), [query, useRegex]);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!activeLevels.has(e.level)) return false;
        if (tagFilter && !(e.tags || []).includes(tagFilter)) return false;
        return matcher.test(e);
      }),
    [entries, activeLevels, tagFilter, matcher]
  );

  const rate = useMemo(() => {
    const buckets = new Array(RATE_SECONDS).fill(0);
    const now = nowMs;
    for (const e of entries) {
      const t = Date.parse(e.iso);
      if (Number.isNaN(t)) continue;
      const age = now - t;
      if (age < 0 || age >= RATE_SECONDS * 1000) continue;
      const idx = RATE_SECONDS - 1 - Math.floor(age / 1000);
      if (idx >= 0 && idx < RATE_SECONDS) buckets[idx] += 1;
    }
    const peak = Math.max(1, ...buckets);
    const perSec = buckets[RATE_SECONDS - 1] || 0;
    return { buckets, peak, perSec };
  }, [entries, nowMs]);

  const selected = useMemo(
    () => (selectedId ? entries.find((e) => e.id === selectedId) || null : null),
    [entries, selectedId]
  );

  const errorCount = counts.ERROR;
  const warnCount = counts.WARN;

  // ── Actions ──────────────────────────────────────────────────────────────
  const toggleLevel = useCallback((level) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  const toggleTag = useCallback((tag) => {
    setTagFilter((prev) => (prev === tag ? null : tag));
  }, []);

  const exportText = useCallback(
    () => filtered.map((e) => e.raw || `${e.time} [${e.level}] ${e.message}`).join("\n"),
    [filtered]
  );

  const copyAll = useCallback(async () => {
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable (permissions / non-secure context);
      // fall back to a transient textarea selection.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }, [exportText]);

  const download = useCallback(
    (kind) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const isJson = kind === "json";
      const blob = new Blob([isJson ? JSON.stringify(filtered, null, 2) : exportText()], {
        type: isJson ? "application/json;charset=utf-8" : "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vela-console-${stamp}.${isJson ? "json" : "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [exportText, filtered]
  );

  const handleClear = useCallback(async () => {
    if (!armedClear) {
      setArmedClear(true);
      clearTimeout(disarmTimerRef.current);
      disarmTimerRef.current = setTimeout(() => setArmedClear(false), 4000);
      return;
    }
    setArmedClear(false);
    clearTimeout(disarmTimerRef.current);
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // The pane empties on the SSE "clear" event.
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  }, [armedClear]);

  const jumpToTail = useCallback(() => {
    stickToBottomRef.current = true;
    setFollow(true);
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, []);

  const copyEntry = useCallback(async (entry) => {
    const text = entry.raw || `${entry.time} [${entry.level}] ${entry.message}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable; the drawer still shows the full text */
    }
  }, []);

  const levelChips = LEVELS.map((level) => ({
    level,
    count: counts[level] || 0,
    on: activeLevels.has(level),
    meta: metaFor(level),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">{translate("Console Log")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {translate("Live gateway output, level by level")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
              connected
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300"
            )}
            role="status"
          >
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-red-500")}
            />
            {connected ? translate("Live") : translate("Disconnected")}
          </span>
          <Button size="sm" variant="outline" icon="refresh" onClick={jumpToTail}>
            {translate("Tail")}
          </Button>
        </div>
      </div>

      {/* ── Telemetry HUD ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-[14px] border border-border-subtle bg-surface p-4 shadow-[var(--shadow-soft)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
              {translate("Levels")}
            </span>
            {levelChips.map(({ level, count, on, meta }) => (
              <button
                key={level}
                type="button"
                onClick={() => toggleLevel(level)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                  on ? meta.hudOn : "border-border bg-surface-2 text-text-muted hover:text-text-main"
                )}
              >
                {level}
                <span className="tabular-nums opacity-80">{count}</span>
              </button>
            ))}
          </div>

          {topTags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                {translate("Tags")}
              </span>
              {topTags.map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={tagFilter === tag}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[8px] border px-2 py-0.5 font-mono text-[11px] transition-colors",
                    tagFilter === tag
                      ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                      : "border-border-subtle bg-surface-2 text-text-muted hover:text-text-main"
                  )}
                >
                  {tag}
                  <span className="tabular-nums opacity-80">{count}</span>
                </button>
              ))}
              {tagFilter && (
                <button
                  type="button"
                  onClick={() => setTagFilter(null)}
                  className="rounded-[8px] px-2 py-0.5 text-[11px] text-text-muted underline decoration-dotted hover:text-text-main"
                >
                  {translate("Clear tag")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Rate meter */}
        <div className="rounded-[14px] border border-border-subtle bg-surface p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
              {translate("Rate")}
            </span>
            <span className="font-mono text-xs tabular-nums text-text-muted">
              {rate.perSec}
              <span className="text-text-subtle">/s</span>
            </span>
          </div>
          <div className="mt-2 flex h-10 items-end gap-[2px]" aria-hidden="true">
            {rate.buckets.map((value, i) => (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-sm",
                  value === 0 ? "bg-surface-3" : i === rate.buckets.length - 1 ? "bg-brand-500" : "bg-brand-500/45"
                )}
                style={{ height: `${Math.max(6, Math.round((value / rate.peak) * 100))}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10.5px] text-text-subtle">
            <span>{translate("30s window")}</span>
            <span className="tabular-nums">
              {translate("Buffered")} {counts.total}/{maxLines}
            </span>
          </div>
        </div>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border-subtle bg-surface p-3 shadow-[var(--shadow-soft)]">
        <div className="relative min-w-[200px] flex-1">
          <span
            aria-hidden="true"
            className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-subtle"
          >
            search
          </span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={translate("Filter console output")}
            placeholder={useRegex ? translate("Regular expression") : translate("Filter output, press / to focus")}
            className={cn(
              "h-8 w-full rounded-[8px] border bg-surface-2 pl-8 pr-2.5 font-mono text-xs text-text-main placeholder:font-sans placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30",
              matcher.error ? "border-red-500/60" : "border-border focus:border-brand-500/60"
            )}
          />
        </div>

        <button
          type="button"
          onClick={() => setUseRegex((v) => !v)}
          aria-pressed={useRegex}
          title={translate("Treat the filter as a regular expression")}
          className={cn(
            "h-8 rounded-[8px] border px-2.5 font-mono text-[11px] font-semibold transition-colors",
            useRegex
              ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300"
              : "border-border bg-surface-2 text-text-muted hover:text-text-main"
          )}
        >
          .*
        </button>

        <div className="flex items-center gap-1 rounded-[10px] bg-surface-2 p-0.5">
          {[
            { value: "structured", label: translate("Structured"), icon: "data_array" },
            { value: "raw", label: translate("Raw"), icon: "data_object" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setView(opt.value)}
              aria-pressed={view === opt.value}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[11px] font-semibold transition-colors",
                view === opt.value ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
                {opt.icon}
              </span>
              {opt.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[11px] tabular-nums text-text-muted">
            {filtered.length}/{entries.length}
          </span>
          <Button
            size="sm"
            variant={follow ? "primary" : "outline"}
            icon={follow ? "vertical_align_bottom" : "pause"}
            aria-pressed={follow}
            onClick={() => {
              setFollow((v) => {
                if (!v) stickToBottomRef.current = true;
                return !v;
              });
            }}
          >
            {follow ? translate("Following") : translate("Paused")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="wrap_text"
            aria-pressed={wrap}
            onClick={() => setWrap((w) => !w)}
          >
            {wrap ? translate("Unwrap") : translate("Wrap")}
          </Button>
          <Button size="sm" variant="outline" icon="content_copy" onClick={copyAll}>
            {translate("Copy")}
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={() => download("txt")}>
            .txt
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={() => download("json")}>
            .json
          </Button>
          <Button
            size="sm"
            variant={armedClear ? "danger" : "outline"}
            icon="delete"
            onClick={handleClear}
          >
            {armedClear ? translate("Confirm clear") : translate("Clear")}
          </Button>
        </div>
      </div>

      {matcher.error && (
        <p className="px-1 text-xs text-red-600 dark:text-red-400">
          {translate("Invalid pattern")}: <span className="font-mono">{matcher.error}</span>
        </p>
      )}

      {/* ── Terminal ───────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[14px] border border-border-subtle bg-[var(--color-terminal)] shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-terminal-text)]/60">
            {view === "structured" ? translate("Structured stream") : translate("Raw stream")}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--color-terminal-text)]/60">
            {warnCount} warn · {errorCount} error
          </span>
        </div>

        <div
          ref={logRef}
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={translate("Console output")}
          className="h-[calc(100vh-430px)] min-h-[280px] overflow-y-auto p-3 font-mono text-xs"
        >
          {filtered.length === 0 ? (
            <p className="p-2 text-[var(--color-terminal-text)]/60">
              {entries.length === 0
                ? translate("No console output yet. Lines appear here as the gateway logs them.")
                : translate("No lines match the current filters.")}
            </p>
          ) : view === "raw" ? (
            <div className="space-y-px">
              {filtered.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  className={cn(
                    "block w-full rounded px-1 text-left text-[var(--color-terminal-text)]/85 hover:bg-white/5 focus-visible:bg-white/5",
                    wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto",
                    metaFor(entry.level).accent,
                    entry.level === "ERROR" || entry.level === "WARN" ? "border-l-2 pl-2" : ""
                  )}
                >
                  {entry.raw || `${entry.time} [${entry.level}] ${entry.message}`}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-px">
              {filtered.map((entry) => {
                const meta = metaFor(entry.level);
                const accent = entry.level === "ERROR" || entry.level === "WARN";
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded px-1 text-left hover:bg-white/5 focus-visible:bg-white/5",
                      accent && `border-l-2 pl-2 ${meta.accent}`
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="w-10 shrink-0 select-none text-right text-[10px] tabular-nums text-[var(--color-terminal-text)]/35"
                    >
                      {entry.seq}
                    </span>
                    <span className="shrink-0 text-[var(--color-terminal-text)]/55">{entry.time}</span>
                    <span className={cn("w-[46px] shrink-0 font-semibold", meta.term)}>{entry.level}</span>
                    <span className={cn("min-w-0 flex-1", wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre")}>
                      {(entry.tags || []).length > 0 && (
                        <span className="mr-1.5 text-[var(--color-terminal-text)]/45">
                          {(entry.tags || []).map((t) => `[${t}]`).join("")}
                        </span>
                      )}
                      <span className="text-[var(--color-terminal-text)]/85">{bodyOf(entry.message)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={jumpToTail}
            className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-brand-500/50 bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-warm)]"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
              arrow_downward
            </span>
            {translate("Jump to latest")}
          </button>
        )}
      </div>

      {/* ── Entry inspector ────────────────────────────────────────────── */}
      <Drawer
        isOpen={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={translate("Log entry")}
        width="lg"
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                  metaFor(selected.level).hudOn
                )}
              >
                {selected.level}
              </span>
              {(selected.tags || []).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setTagFilter(tag);
                    setSelectedId(null);
                  }}
                  className="rounded-[8px] border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-muted hover:text-text-main"
                >
                  {tag}
                </button>
              ))}
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: translate("Time"), value: selected.time, mono: true },
                { label: translate("Timestamp"), value: selected.iso, mono: true },
                { label: translate("Sequence"), value: String(selected.seq), mono: true },
                { label: translate("Entry id"), value: selected.id, mono: true },
              ].map((row) => (
                <div key={row.label} className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
                  <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-text-subtle">
                    {row.label}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-[11.5px] text-text-main">{row.value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-subtle">
                {translate("Message")}
              </p>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[var(--color-terminal)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--color-terminal-text)]">
                {selected.message}
              </pre>
            </div>

            {selected.raw && selected.raw !== selected.message && (
              <div>
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-subtle">
                  {translate("Raw line")}
                </p>
                <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-border-subtle bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-text-muted">
                  {selected.raw}
                </pre>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" icon="content_copy" onClick={() => copyEntry(selected)}>
                {translate("Copy entry")}
              </Button>
              <span className="text-[11px] text-text-subtle">
                {selected.message.length} {translate("characters")}
              </span>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
