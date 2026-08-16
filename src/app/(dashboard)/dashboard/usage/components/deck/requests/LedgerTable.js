// Usage Observatory W2-E — the server-paginated ledger (sealed plan Deck-3).
// Keyset pagination over GET /api/usage/metrics/ledger: the first page loads
// with the Needle facets + sort; "Show more" appends the next keyset page
// (never OFFSET — the walk is O(page), the cursor carries the sort column's
// own value). The table NEVER re-sorts under the user's cursor — fresh rows
// surface as the 'N new requests' pill and apply on click.
//
// Keyboard first-class (Manifest graft): rows are focusable; ↑/↓ traverse,
// Enter/Space opens the drawer. Sort clicks write sort+order atomically to
// the URL (setFacets) — one navigation, bookmarkable, dormant facets survive.
//
// State discipline: the first-page fetch lives in ONE state object tagged
// with its query key — loading/staleness derive during render, and every
// setState rides an async fetch callback (never synchronously in an effect).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Card from "@/shared/components/Card";
import { t } from "../../../lib/t";
import { useUsageStream } from "../../../hooks/useUsageStream";
import LedgerRow from "./LedgerRow";
import LedgerDrawer from "./LedgerDrawer";
import NewRequestsPill from "./NewRequestsPill";

const PAGE_SIZE = 50;

const COLS = [
  { key: "timestamp", label: "Time" },
  { key: "provider", label: "Provider" },
  { key: "model", label: "Model" },
  { key: "keyId", label: "Key" },
  { key: "promptTokens", label: "Input", align: "right" },
  { key: "completionTokens", label: "Output", align: "right" },
  { key: "cost", label: "Cost", align: "right" },
  { key: "latencyMs", label: "Latency", align: "right" },
  { key: "status", label: "Status" },
];

function Head({ colKey, label, align, sort, order, setSort }) {
  const active = sort === colKey;
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => setSort(colKey)}
        className={`inline-flex items-center gap-0.5 transition-colors hover:text-text ${active ? "text-text" : ""}`}
      >
        {label}
        {active && (
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
            {order === "asc" ? "arrow_upward" : "arrow_downward"}
          </span>
        )}
      </button>
    </th>
  );
}

export default function LedgerTable({ compass }) {
  const { metricsQuery, sort, order, setSort, q, setFacet, period } = compass;

  // The query key — every facet change + sort change + pill refresh moves it.
  const [refreshKey, setRefreshKey] = useState(0);
  const queryKey = `${metricsQuery}|${sort}|${order}|${refreshKey}`;

  // One fetch-state object tagged with its query key. When the key moves,
  // `page.key !== queryKey` derives loading + empty rows during render — no
  // synchronous reset inside the effect.
  const [page, setPage] = useState({ key: "", items: [], cursor: null, hasMore: false, failed: false });
  const loading = page.key !== queryKey;
  const rows = useMemo(() => (loading ? [] : page.items), [loading, page.items]);

  useEffect(() => {
    let cancelled = false;
    const qs = `${metricsQuery}&sort=${encodeURIComponent(sort)}&order=${order}&limit=${PAGE_SIZE}`;
    fetch(`/api/usage/metrics/ledger?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setPage({ key: queryKey, items: [], cursor: null, hasMore: false, failed: true });
          return;
        }
        setPage({
          key: queryKey,
          items: data.items || [],
          cursor: data.nextCursor || null,
          hasMore: Boolean(data.nextCursor),
          failed: false,
        });
      })
      .catch(() => {
        if (!cancelled) setPage({ key: queryKey, items: [], cursor: null, hasMore: false, failed: true });
      });
    return () => { cancelled = true; };
  }, [queryKey, metricsQuery, sort, order]);

  // Keyset continuation — appends; the cursor rides the previous last row.
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    if (!page.cursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const qs = `${metricsQuery}&sort=${encodeURIComponent(sort)}&order=${order}&limit=${PAGE_SIZE}&after=${encodeURIComponent(JSON.stringify(page.cursor))}`;
      const res = await fetch(`/api/usage/metrics/ledger?${qs}`);
      const data = res.ok ? await res.json() : null;
      if (data) {
        setPage((prev) => {
          if (prev.key !== queryKey) return prev; // a facet moved mid-flight — drop it
          const seen = new Set(prev.items.map((r) => r.id));
          return {
            ...prev,
            items: [...prev.items, ...(data.items || []).filter((r) => !seen.has(r.id))],
            cursor: data.nextCursor || null,
            hasMore: Boolean(data.nextCursor),
          };
        });
      }
    } catch { /* fail-open */ } finally {
      setLoadingMore(false);
    }
  }, [page.cursor, loadingMore, loading, metricsQuery, sort, order, queryKey]);

  // Deck-local search facet — local draft synced to the URL during render
  // (the documented adjust-state-in-render pattern; never an effect), then
  // debounced into `q` (census LIKE over model/provider/endpoint, server-side).
  const [qDraft, setQDraft] = useState({ value: q, external: q });
  if (qDraft.external !== q) setQDraft({ value: q, external: q });
  useEffect(() => {
    if (qDraft.value === q) return undefined;
    const id = setTimeout(() => setFacet("q", qDraft.value || null), 300);
    return () => clearTimeout(id);
  }, [qDraft.value, q, setFacet]);

  // The 'N new' pill — derived, never stored: recent ids not yet on screen.
  const { stats } = useUsageStream(period);
  const recent = stats?.recentRequests;
  const pillCount = useMemo(() => {
    if (!Array.isArray(recent)) return 0;
    const ids = new Set(rows.map((r) => r.id));
    return recent.filter((r) => r && r.id != null && !ids.has(r.id)).length;
  }, [recent, rows]);

  const applyPill = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Keyboard traversal — ↑/↓ across rows (the wrapper owns the arrows).
  const tableRef = useRef(null);
  const onKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const trs = Array.from(tableRef.current?.querySelectorAll("[data-ledger-row]") || []);
    if (!trs.length) return;
    const idx = trs.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? Math.min(idx + 1, trs.length - 1) : Math.max(idx - 1, 0);
    trs[next]?.focus();
  };

  // The drawer — one state, opened by row click / Enter.
  const [drawerRow, setDrawerRow] = useState(null);

  return (
    <>
      <Card padding="none">
        {/* Deck-local toolbar — search + new-pill */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">search</span>
            <input
              type="text"
              value={qDraft.value}
              onChange={(e) => setQDraft({ value: e.target.value, external: q })}
              placeholder={t("Search model, provider, endpoint…")}
              aria-label={t("Search model, provider, endpoint…")}
              className="h-8 w-64 max-w-full rounded-lg border border-border bg-bg-subtle pl-8 pr-3 text-xs text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <NewRequestsPill count={pillCount} onApply={applyPill} />
        </div>

        {/* The ledger */}
        <div ref={tableRef} onKeyDown={onKeyDown} className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b border-border bg-bg-subtle/50">
                {COLS.map((c) => (
                  <Head key={c.key} colKey={c.key} label={t(c.label)} align={c.align} sort={sort} order={order} setSort={setSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td colSpan={COLS.length} className="px-3 py-2.5">
                      <div className="h-5 animate-pulse rounded bg-bg-subtle" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="px-3 py-10 text-center text-sm text-text-muted">
                    {page.failed ? t("Failed to fetch request details") : t("No traffic yet — send a request to see it here.")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <LedgerRow key={row.id} row={row} active={drawerRow?.id === row.id} onOpen={setDrawerRow} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer — loaded count + keyset continuation */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-xs tabular-nums text-text-muted" data-i18n-skip="true">{rows.length}</span>
          {!loading && page.hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-border bg-surface px-3 py-1 text-xs font-medium text-text-main transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {loadingMore ? t("Loading") : t("Show more")}
            </button>
          )}
        </div>
      </Card>

      {drawerRow && <LedgerDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />}
    </>
  );
}
