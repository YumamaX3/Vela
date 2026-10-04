// UnifiedTail — §7's one tail over console + container + request + persisted.
//
// ── ONE RENDERING, BOTH SOURCES (§1's law) ──────────────────────────────────
// The live stream door replays the newest persisted rows ASCENDING and then
// sends live frames shaped to the same `toWireRow` field set. Both land in the
// SAME `rows` array and go through the SAME `<LogRow>`. There is no second
// live-shaped component: two renderers for two sources is exactly how the two
// shapes drift apart forever, and §1 forbids it in writing.
//
// ── THE ROW ID QUESTION, ANSWERED ONCE ──────────────────────────────────────
// A persisted row has `id`; a live frame does not (the worker assigns the row
// id when it drains). `rowKey` names the fallback — `l<ts>:<seq>` — from ONE
// place, so no call site re-derives it and a thousand live rows never collide
// on `undefined`.
//
// ── BACKPRESSURE, HONESTLY ──────────────────────────────────────────────────
// The stream door drops OLDEST frames under pressure and says so with a
// `# missed N` comment frame. EventSource never surfaces comment frames to
// `onmessage`, so the gap is read from the raw text via `addEventListener` on
// the same connection — one connection, no second socket. A gap draws a marker
// LINE in the tail, never a silently short list.
//
// ── PAGING ──────────────────────────────────────────────────────────────────
// The events door pages by keyset cursor (`before`), never OFFSET. The tail
// requests the next page when the scroll window approaches the end of what it
// holds, so a 200k-row result streams in without ever holding 200k rows in
// the DOM (or, past the retention window, in memory either: the browser keeps
// what it has scrolled, and the window paints ~50 of it).
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";
import LogRow, { formatMeta, formatRowTime, levelName, levelTone, rowKey } from "./LogRow";
import LogFilterBar, { filterToParams, isEmptyFilter } from "./LogFilterBar";
import LogPostureBanner from "./LogPostureBanner";
import VoyageView from "./VoyageView";
import useWindowedList, { OVERSCAN, ROW_HEIGHT } from "./useWindowedList";

/** The newest rows the tail asks for on a fresh filter. */
const FIRST_PAGE = 500;

/** How close to the loaded end (in rows) before the next page is fetched. */
const PAGE_AHEAD = 40;

/** Rows the tail keeps before dropping the oldest — a memory bound, not a lie:
 *  the banner states the bound and the `# missed` marker states the drops. */
const LIVE_CAP = 5_000;

/** Merge new rows into the tail, dropping the oldest past `cap`. */
function mergeRows(prev, incoming) {
  if (!incoming.length) return prev;
  // The stream door replays before it subscribes, so a row can legitimately
  // arrive twice (the door documents this as the benign cost of the ordering).
  // Deduping by rowKey is what keeps that from painting a visible duplicate.
  const seen = new Set(prev.map(rowKey));
  const fresh = [];
  for (const r of incoming) {
    const k = rowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(r);
  }
  if (!fresh.length) return prev;
  const next = [...prev, ...fresh];
  return next.length > LIVE_CAP ? next.slice(-LIVE_CAP) : next;
}

export default function UnifiedTail() {
  const [filter, setFilter] = useState({});
  const [rows, setRows] = useState([]);
  const [connected, setConnected] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [inspect, setInspect] = useState(false);
  const [voyage, setVoyage] = useState(false);
  const [gap, setGap] = useState(null);
  const [filterError, setFilterError] = useState(null);
  const [qHonoured, setQHonoured] = useState(null);
  const [qIgnored, setQIgnored] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);
  const [follow, setFollow] = useState(true);
  const [saved, setSaved] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  const filterKey = useMemo(() => filterToParams(filter).toString(), [filter]);
  const esRef = useRef(null);

  // ── Saved filters, read once on mount ────────────────────────────────────
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("vela_log_filters");
      setSaved(raw ? JSON.parse(raw) : []);
    } catch {
      setSaved([]);
    }
    setHydrated(true);
  }, []);

  const persistSaved = useCallback((next) => {
    setSaved(next);
    try {
      window.localStorage.setItem("vela_log_filters", JSON.stringify(next));
    } catch {
      /* private mode — the harbor still filters, it just forgets */
    }
  }, []);

  // ── The live tail ────────────────────────────────────────────────────────
  useEffect(() => {
    const params = filterToParams(filter);
    const es = new EventSource(`/api/logs/events/stream?${params.toString()}`);
    esRef.current = es;
    setRows([]);
    setCursor(null);
    setHasMore(false);
    setGap(null);
    setSelectedKey(null);
    setFilterError(null);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "init") {
        const replay = Array.isArray(msg.replay) ? msg.replay : [];
        // The replay is ASCENDING by the door's own contract — one rendering,
        // arrival order, no client-side reverse.
        setRows(replay);
        setQHonoured(typeof msg.qHonoured === "boolean" ? msg.qHonoured : null);
        setQIgnored(Boolean(msg.qIgnoredBecauseUnnarrowed));
        if (msg.replayError) setFilterError(String(msg.replayError));
      } else if (msg.type === "log") {
        setRows((prev) => mergeRows(prev, [msg.row]));
      } else if (msg.type === "clear") {
        setRows([]);
        setSelectedKey(null);
      }
    };

    // The `# missed N` frame is an SSE COMMENT, so `onmessage` never sees it.
    // Reading it off the same connection is the only way the harbor can say
    // "you lost lines" instead of rendering a silently short tail.
    const onRawEvent = (e) => {
      if (typeof e.data !== "string") return;
      const m = e.data.match(/^# missed (\d+)/);
      if (m) setGap((prev) => (prev ?? 0) + Number(m[1]));
    };
    es.addEventListener("message", onRawEvent);

    return () => {
      es.removeEventListener("message", onRawEvent);
      es.close();
      esRef.current = null;
    };
    // `filterKey` is the whole selector, serialized — re-sailing on the object
    // would restart the stream on every keystroke of an unrelated draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // ── Keyset paging for the queried half ───────────────────────────────────
  const fetchOlder = useCallback(async () => {
    if (paging) return;
    setPaging(true);
    try {
      const params = filterToParams(filter);
      params.set("limit", String(FIRST_PAGE));
      if (cursor) params.set("before", String(cursor));
      const res = await fetch(`/api/logs/events?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `The events door answered ${res.status}.`);
      }
      const data = await res.json();
      const page = Array.isArray(data.rows) ? data.rows : [];
      setRows((prev) => {
        // DESC → ASC so the merged list stays in arrival order end to end.
        const next = mergeRows([...page].reverse(), prev);
        return next;
      });
      setCursor(data.nextCursor ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch (e) {
      setFilterError(String(e?.message ?? e));
    } finally {
      setPaging(false);
    }
  }, [cursor, filter, paging]);

  useEffect(() => {
    if (!hasMore || cursor === null) return;
    fetchOlder();
  }, [hasMore, cursor, fetchOlder]);

  // ── The window ───────────────────────────────────────────────────────────
  const list = useWindowedList(rows, { follow });

  // ── j/k keyboard navigation ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "j" && e.key !== "k") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      setSelectedKey((prev) => {
        const idx = prev ? rows.findIndex((r) => rowKey(r) === prev) : -1;
        const next = e.key === "j" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
        return rows[next] ? rowKey(rows[next]) : prev;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows]);

  // Keep the selected row inside the painted window.
  useEffect(() => {
    if (!selectedKey) return;
    const idx = rows.findIndex((r) => rowKey(r) === selectedKey);
    if (idx < list.startIndex || idx >= list.endIndex) {
      list.scrollRef.current?.scrollTo?.({ top: Math.max(0, idx * ROW_HEIGHT - ROW_HEIGHT * 4) });
    }
  }, [selectedKey, rows, list.startIndex, list.endIndex, list.scrollRef]);

  const selectedIndex = selectedKey ? rows.findIndex((r) => rowKey(r) === selectedKey) : -1;
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;

  const facets = useMemo(() => {
    const providers = new Set();
    const tags = new Set();
    for (const r of rows) {
      if (r.provider) providers.add(r.provider);
      if (r.tag) tags.add(r.tag);
    }
    return {
      providers: [...providers].sort().slice(0, 24),
      tags: [...tags].sort().slice(0, 24),
    };
  }, [rows]);

  const exportNdjson = useCallback(() => {
    // NDJSON — §1's law. NOT CSV: inside JSON a leading `=` is an inert string
    // character, and the CSV quoting defense belongs to the CSV export it was
    // built for.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([rows.map((r) => JSON.stringify(r)).join("\n")], {
      type: "application/x-ndjson;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vela-logs-${stamp}.ndjson`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <LogPostureBanner />

      <LogFilterBar
        filter={filter}
        onChange={setFilter}
        qHonoured={qHonoured}
        qIgnoredBecauseUnnarrowed={qIgnored}
        filterError={filterError}
        rowCount={rows.length}
        saved={hydrated ? saved : []}
        onSavedChange={persistSaved}
        facets={facets}
      />

      {/* ── Controls ──────────────────────────────────────────────────── */}
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
          {connected ? translate("Live") : translate("Reconnecting")}
        </span>

        <span className="font-mono text-2xs tabular-nums text-text-muted">
          {rows.length} {translate("rows")} · {translate("window")} {list.startIndex}–{list.endIndex}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {hasMore && (
            <Button size="sm" variant="ghost" icon="expand_more" onClick={fetchOlder} loading={paging}>
              {translate("Older")}
            </Button>
          )}
          <Button
            size="sm"
            variant={follow ? "primary" : "outline"}
            icon={follow ? "vertical_align_bottom" : "pause"}
            aria-pressed={follow}
            onClick={() => {
              if (!follow) list.jumpToTail();
              setFollow((v) => !v);
            }}
          >
            {follow ? translate("Following") : translate("Paused")}
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={exportNdjson}>
            .ndjson
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon="travel_explore"
            disabled={!selected}
            onClick={() => setVoyage(true)}
          >
            {translate("Voyage")}
          </Button>
        </div>
      </div>

      {/* ── The tail ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[14px] border border-border-subtle bg-[var(--color-terminal)] shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="font-mono text-2xs uppercase tracking-wider text-[var(--color-terminal-text)]/60">
            {translate("Unified tail")} — {translate("scrubbed rows, live and queried")}
          </span>
          <span className="font-mono text-2xs tabular-nums text-[var(--color-terminal-text)]/60">
            {translate("j")}/{translate("k")} {translate("to move")} · {translate("Enter")}{" "}
            {translate("to inspect")}
          </span>
        </div>

        <div
          ref={list.scrollRef}
          onScroll={list.onScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={translate("Unified log tail")}
          className="h-[calc(100vh-460px)] min-h-[280px] overflow-y-auto font-mono text-xs"
        >
          {rows.length === 0 ? (
            <p className="p-3 text-[var(--color-terminal-text)]/70">
              {isEmptyFilter(filter)
                ? translate(
                    "The harbor is quiet: the gateway has logged nothing yet. Lines surface here the moment it speaks, live and durable alike."
                  )
                : translate("No rows answer to this filter. Widen a chip, and the tide returns.")}
            </p>
          ) : (
            <div style={{ height: list.totalHeight, position: "relative" }}>
              <div style={{ transform: `translateY(${list.offsetY}px)` }}>
                {list.window.map((row, i) => (
                  <div key={rowKey(row)} className="contents">
                    {list.startIndex + i === 0 && gap ? (
                      <div className="px-2 py-0.5 font-mono text-2xs text-amber-300">
                        {translate(`# missed ${gap} line(s) under backpressure — the tail is not complete`)}
                      </div>
                    ) : null}
                    <LogRow
                      row={row}
                      index={list.startIndex + i}
                      total={rows.length}
                      rowHeight={ROW_HEIGHT}
                      selected={rowKey(row) === selectedKey}
                      onSelect={(r) => {
                        setSelectedKey(rowKey(r));
                        setInspect(true);
                      }}
                      onOpen={() => setVoyage(true)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!list.atBottom && (
          <button
            type="button"
            onClick={list.jumpToTail}
            className="absolute bottom-4 right-4 inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-brand-500/50 bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-warm)]"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">
              arrow_downward
            </span>
            {translate("Jump to latest")}
          </button>
        )}
      </div>

      <p className="px-1 text-2xs text-text-subtle">
        {translate(
          "Rows render as TEXT, never as markup: an upstream error body cannot become script against your own session. Truncation ⟂ marks a row clamped at the write door."
        )}
      </p>

      {/* ── Inspector ─────────────────────────────────────────────────── */}
      <Drawer isOpen={inspect && Boolean(selected)} onClose={() => setInspect(false)} title={translate("Log entry")} width="lg">
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full border px-2.5 py-0.5 text-2xs font-semibold", levelTone(selected.lvl).hud)}>
                {levelName(selected.lvl)}
              </span>
              <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-text-muted">
                {selected.stream}
              </span>
              {selected.provider && (
                <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-text-muted">
                  {selected.provider}
                </span>
              )}
              {selected.tag && (
                <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-text-muted">
                  [{selected.tag}]
                </span>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: translate("Time"), value: formatRowTime(selected.ts), mono: true },
                { label: translate("Row id"), value: selected.id === null ? translate("live — assigned on persist") : String(selected.id), mono: true },
                { label: translate("Voyage"), value: selected.reqId ?? translate("unjoinable"), mono: true },
                { label: translate("Upstream call"), value: selected.upstreamId ?? translate("none"), mono: true },
              ].map((f) => (
                <div key={f.label} className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
                  <dt className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">{f.label}</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-text-main">{f.value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                {translate("Message")}
              </p>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[var(--color-terminal)] p-3 font-mono text-xs leading-relaxed text-[var(--color-terminal-text)]">
                {selected.msg}
              </pre>
            </div>

            {/* Meta as PRE-FORMATTED TEXT. §7: an inspector with meta JSON, and
                the rendering law says text only — a JSON blob is data, not
                markup, and this is where that is decided. */}
            {formatMeta(selected.meta) && (
              <div>
                <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                  {translate("Meta")}
                </p>
                <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border-subtle bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-muted">
                  {formatMeta(selected.meta)}
                </pre>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                icon="travel_explore"
                disabled={!selected.reqId}
                onClick={() => {
                  setInspect(false);
                  setVoyage(true);
                }}
              >
                {selected.reqId ? translate("Open voyage") : translate("Unjoinable")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon="content_copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selected.msg);
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
              >
                {translate("Copy")}
              </Button>
              <span className="text-2xs text-text-subtle">
                {String(selected.msg ?? "").length} {translate("characters")}
              </span>
            </div>
          </div>
        )}
      </Drawer>

      <VoyageView row={selected} isOpen={voyage} onClose={() => setVoyage(false)} />
    </div>
  );
}