"use client";
// Container Stream — the raw process stdout/stderr tap.
//
// This is the shore Dozzle used to hold: what the process itself prints on the
// box that never travelled through console.* — the MITM child's relayed logs,
// dependency prints, crash stacks, framework warnings. The gateway taps
// process.stdout.write / process.stderr.write inside its own process
// (src/lib/consoleLogBuffer.js) and streams the lines here. Level is inferred:
// stderr → ERROR, stdout → LOG, sharpened by keyword (tracebacks, "warn").
//
// Honest scope: the tap installs at boot via src/instrumentation.js (and again
// at module scope in src/app/layout.js), so it misses whatever the process
// printed before the first request — the Next startup banner among it. What it
// catches from then on is the part `docker logs` shows that the Console stream
// cannot. Writes that go straight to fd 1 from a child (`stdio: […, 1, 1]`)
// bypass the tap by definition and are never in here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";

const LEVELS = ["LOG", "WARN", "ERROR"];
const STREAMS = ["stdout", "stderr"];
const LEVEL_META = {
  LOG: { term: "text-[var(--color-terminal-text)]", badge: "border-slate-500/50 bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  WARN: { term: "text-amber-300", badge: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  ERROR: { term: "text-red-400", badge: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300" },
};
function metaFor(level) {
  return LEVEL_META[level] || LEVEL_META.LOG;
}
function buildMatcher(query, useRegex) {
  const q = query.trim();
  if (!q) return { test: () => true, error: null };
  if (!useRegex) {
    const lower = q.toLowerCase();
    return { test: (e) => e.message.toLowerCase().includes(lower) || e.time.includes(lower), error: null };
  }
  try {
    const re = new RegExp(q, "i");
    return { test: (e) => re.test(e.message) || re.test(e.time), error: null };
  } catch (err) {
    return { test: () => false, error: err.message };
  }
}

export default function ContainerStream() {
  const [entries, setEntries] = useState([]);
  const [connected, setConnected] = useState(false);
  const [activeLevels, setActiveLevels] = useState(() => new Set(LEVELS));
  const [streamFilter, setStreamFilter] = useState(null);
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const logRef = useRef(null);
  const stickToBottomRef = useRef(true);
  // ── Stream (same SSE channel; this stream reads the raw entries) ─────────
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
        setEntries(Array.isArray(msg.rawLogs) ? msg.rawLogs : []);
      } else if (msg.type === "raw") {
        setEntries((prev) => {
          const next = prev.length ? [...prev, ...msg.entries] : msg.entries;
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      } else if (msg.type === "clear") {
        setEntries([]);
        setSelectedId(null);
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);
  useEffect(() => {
    if (follow && stickToBottomRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries, follow, wrap]);
  const handleScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, []);
  const counts = useMemo(() => {
    const out = { total: entries.length, LOG: 0, WARN: 0, ERROR: 0, stderr: 0 };
    for (const e of entries) {
      if (out[e.level] !== undefined) out[e.level] += 1;
      if (e.stream === "stderr") out.stderr += 1;
    }
    return out;
  }, [entries]);
  const matcher = useMemo(() => buildMatcher(query, useRegex), [query, useRegex]);
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!activeLevels.has(e.level)) return false;
        if (streamFilter && e.stream !== streamFilter) return false;
        return matcher.test(e);
      }),
    [entries, activeLevels, streamFilter, matcher]
  );
  const selected = useMemo(
    () => (selectedId ? entries.find((e) => e.id === selectedId) || null : null),
    [entries, selectedId]
  );
  const toggleLevel = useCallback((level) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);
  const exportText = useCallback(() => filtered.map((e) => e.raw).join("\n"), [filtered]);
  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportText());
    } catch {
      /* clipboard unavailable */
    }
  }, [exportText]);
  const download = useCallback(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([exportText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vela-container-${stamp}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportText]);
  const jumpToTail = useCallback(() => {
    stickToBottomRef.current = true;
    setFollow(true);
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, []);
  return (
    <div className="flex flex-col gap-4">
      {/* ── Controls strip ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border-subtle bg-surface p-3 shadow-[var(--shadow-soft)]">
        <span
          role="status"
          className={cn(
            "inline-flex min-h-[26px] items-center gap-2 rounded-full border px-3 py-1 text-2xs font-semibold",
            connected
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300"
          )}
        >
          <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-red-500")} />
          {connected ? translate("Tapped") : translate("Untapped")}
        </span>
        {/* Level filter */}
        <div className="flex items-center gap-1 rounded-[10px] bg-surface-2 p-0.5">
          {LEVELS.map((level) => {
            const on = activeLevels.has(level);
            return (
              <button
                key={level}
                type="button"
                onClick={() => toggleLevel(level)}
                aria-pressed={on}
                className={cn(
                  "inline-flex min-h-[28px] items-center gap-1.5 rounded-[8px] border px-2.5 text-2xs font-semibold motion-control",
                  on ? metaFor(level).badge : "border-transparent text-text-muted hover:text-text-main"
                )}
              >
                {level}
                <span className="tabular-nums opacity-80">{counts[level] || 0}</span>
              </button>
            );
          })}
        </div>
        {/* Stream filter */}
        <div className="flex items-center gap-1 rounded-[10px] bg-surface-2 p-0.5">
          {STREAMS.map((s) => {
            const on = streamFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStreamFilter((prev) => (prev === s ? null : s))}
                aria-pressed={on}
                className={cn(
                  "inline-flex min-h-[28px] items-center gap-1.5 rounded-[8px] px-2.5 font-mono text-2xs font-semibold motion-control",
                  on ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
                )}
              >
                {s}
                {s === "stderr" && <span className="tabular-nums opacity-80">{counts.stderr}</span>}
              </button>
            );
          })}
        </div>
        {/* Search */}
        <div className="relative min-w-[180px] flex-1">
          <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-text-subtle">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={translate("Filter container output")}
            placeholder={useRegex ? translate("Regular expression") : translate("Filter the raw stream")}
            className={cn(
              "h-8 w-full rounded-[8px] border bg-surface-2 pl-8 pr-2.5 font-mono text-xs text-text-main placeholder:font-sans placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30",
              matcher.error ? "border-red-500/60" : "border-border-strong focus:border-brand-500/60"
            )}
          />
        </div>
        <button
          type="button"
          onClick={() => setUseRegex((v) => !v)}
          aria-pressed={useRegex}
          title={translate("Treat the filter as a regular expression")}
          className={cn(
            "inline-flex min-h-[32px] items-center rounded-[8px] border px-2.5 font-mono text-2xs font-semibold motion-control",
            useRegex ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300" : "border-border-strong bg-surface-2 text-text-muted hover:text-text-main"
          )}
        >
          .*
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-2xs tabular-nums text-text-muted">
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
          <Button size="sm" variant="ghost" icon="wrap_text" aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>
            {wrap ? translate("Unwrap") : translate("Wrap")}
          </Button>
          <Button size="sm" variant="outline" icon="content_copy" onClick={copyAll}>
            {translate("Copy")}
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={download}>
            .log
          </Button>
        </div>
      </div>
      {matcher.error && (
        <p className="px-1 text-xs text-red-600 dark:text-red-400">
          {translate("Invalid pattern")}: <span className="font-mono">{matcher.error}</span>
        </p>
      )}
      {/* ── Raw terminal ───────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[14px] border border-border-subtle bg-[var(--color-terminal)] shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="font-mono text-2xs uppercase tracking-wider text-[var(--color-terminal-text)]/60">
            {translate("Raw process stream")}
          </span>
          <span className="font-mono text-2xs tabular-nums text-[var(--color-terminal-text)]/60">
            stdout {counts.total - counts.stderr} · stderr {counts.stderr}
          </span>
        </div>
        <div
          ref={logRef}
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={translate("Container output")}
          className="h-[calc(100vh-420px)] min-h-[280px] overflow-y-auto p-3 font-mono text-xs"
        >
          {filtered.length === 0 ? (
            <p className="p-2 text-[var(--color-terminal-text)]/70">
              {entries.length === 0
                ? translate("Nothing raw has surfaced yet. This stream carries what the process itself prints: the parts the console never sees.")
                : translate("No raw lines answer to the current filters.")}
            </p>
          ) : (
            <div className="space-y-px">
              {filtered.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded px-1 text-left hover:bg-white/5 focus-visible:bg-white/5",
                    entry.level === "ERROR" && "border-l-2 border-l-red-500/60 pl-2",
                    entry.level === "WARN" && "border-l-2 border-l-amber-500/60 pl-2"
                  )}
                >
                  <span aria-hidden="true" className="w-10 shrink-0 select-none text-right text-3xs tabular-nums text-[var(--color-terminal-text)]/55">
                    {entry.seq}
                  </span>
                  <span className="shrink-0 text-[var(--color-terminal-text)]/65">{entry.time}</span>
                  <span className={cn("w-[52px] shrink-0 font-semibold", metaFor(entry.level).term)}>{entry.level}</span>
                  <span className={cn("min-w-0 flex-1 text-[var(--color-terminal-text)]/85", wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre overflow-x-auto")}>
                    {entry.message}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={jumpToTail}
            className="absolute bottom-4 right-4 inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-brand-500/50 bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-warm)]"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">
              arrow_downward
            </span>
            {translate("Jump to latest")}
          </button>
        )}
      </div>
      {/* ── Line inspector ─────────────────────────────────────────────── */}
      <Drawer isOpen={Boolean(selected)} onClose={() => setSelectedId(null)} title={translate("Container line")} width="lg">
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full border px-2.5 py-0.5 text-2xs font-semibold", metaFor(selected.level).badge)}>
                {selected.level}
              </span>
              <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-text-muted">
                {selected.stream}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: translate("Time"), value: selected.time },
                { label: translate("Timestamp"), value: selected.iso },
                { label: translate("Sequence"), value: String(selected.seq) },
                { label: translate("Line id"), value: selected.id },
              ].map((row) => (
                <div key={row.label} className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
                  <dt className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">{row.label}</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-text-main">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                {translate("Line")}
              </p>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[var(--color-terminal)] p-3 font-mono text-xs leading-relaxed text-[var(--color-terminal-text)]">
                {selected.message}
              </pre>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                icon="content_copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selected.raw || selected.message);
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
              >
                {translate("Copy line")}
              </Button>
              <span className="text-2xs text-text-subtle">
                {selected.message.length} {translate("characters")}
              </span>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
