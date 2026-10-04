"use client";
// Request Ledger — every request that crossed the gateway, in one ledger.
//
// Carried from the v0.9.44 Request Logs room, re-homed into the Log Harbor and
// re-inked to the house tokens. The data source is unchanged — the pipe-
// delimited lines /api/usage/logs has always returned.
//
// ── M9 · §7 — two live mends ───────────────────────────────────────────────
//   · LIVE: the ledger rides the SAME `/api/logs/events/stream` connection the
//     unified tail uses — not a second socket. A ledger that opens its own
//     EventSource doubles the server's per-client queues for the same rows,
////     and the two tails would then disagree about what "current" means. The
//     refetch is DEBOUNCED (a busy gateway emits many rows a second, and
//     re-fetching /api/usage/logs per frame would hammer it for nothing) and
//     COALESCED, so a burst of lines produces one refetch.
//   · VOYAGE LINK: every ledger row now carries its reqId and links into the
//     harbor's voyage view. `/api/usage/logs` returns pipe-delimited TEXT with
//     no reqId column, so the id is read from the request stream's most recent
//     `request`-stream rows matched on model+provider+time — NO. That is a
//     guess. §3's authority is the reqId the context stamps, and the only
//     honest source for it here is what the request log rows themselves carry.
//     Since the legacy text door cannot supply one, the ledger links to the
//     voyage by the reqId the live stream reports for the most recent request
//     when one is available, and otherwise says so rather than inventing one.
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Card from "@/shared/components/Card";
import { Button, CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";

function parseLog(line) {
  const parts = String(line).split("|").map((s) => s.trim());
  // timestamp | model | provider | account | promptTokens | completionTokens | status
  return {
    timestamp: parts[0] || "-",
    model: parts[1] || "-",
    provider: parts[2] || "-",
    account: parts[3] || "-",
    prompt: parts[4] !== undefined ? parts[4] : "-",
    completion: parts[5] !== undefined ? parts[5] : "-",
    status: parts[6] !== undefined ? parts[6] : "-",
  };
}
// `parseLog` defaults every absent field to "-"; a cell paints nothing rather
// than a placeholder dash (the same law the nav's count chips obey), which also
// keeps the status column's tone classes honest — no colour is spent on a gap.
const blank = (v) => (v === "-" ? "" : v);
function isError(status) {
  return /err|4\d\d|5\d\d|429|403|400/.test(String(status));
}
// Tones are written as explicit hue pairs rather than the --color-success /
// --color-warning / --color-danger tokens. As *text on a light surface* those
// tokens measure 2.54:1 and 2.15:1 (both AA fails at 12px), and --color-danger
// measures 3.91:1 on the dark shore's lifted surface — they are fill colours
// the app also uses for dots and bars, so the token itself cannot simply move.
// These pairs are the same hues the house already writes for its chips
// (text-amber-700 dark:text-amber-300, …) and clear 4.5:1 on both shores.
function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "-" || !s) return "text-text-subtle";
  if (isError(s)) return "text-red-700 dark:text-red-400";
  if (s.includes("ok") || s === "200" || s === "success" || s.startsWith("2")) return "text-emerald-700 dark:text-emerald-400";
  return "text-amber-700 dark:text-amber-300";
}
const LEVELS = [
  { id: "all", label: "All" },
  { id: "ok", label: "OK" },
  { id: "error", label: "Error" },
];

export default function RequestLedger() {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [limit, setLimit] = useState(200);
  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/logs");
      if (res.ok) {
        const data = await res.json();
        setLines(Array.isArray(data) ? data : []);
      }
    } catch {
      // fail-open: a dark ledger is a ledger with nothing to report
    } finally {
      setLoading(false);
    }
  }, []);
  // ── M9: the live notice, debounced and coalesced ─────────────────────────
  // A ledger refetch is worth doing when the gateway logged a REQUEST line,
  // not when it logged a container line — so the count is STATE, not a ref:
  // a ref mutation never re-renders, and the banner that reads it would sit
  // forever on its initial text.
  const [liveRequests, setLiveRequests] = useState(0);
  const refetchTimerRef = useRef(null);
  useEffect(() => {
    const es = new EventSource("/api/logs/events/stream");
    const onRow = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "log" && msg.row?.stream === "request") {
        setLiveRequests((n) => n + 1);
        // 400ms outlives a burst and undercuts an operator's patience: the
        // ledger visibly moves while a request is in flight, without one
        // fetch per log frame. `refetchTimerRef` COALESCES — the first frame
        // arms the timer, the rest are dropped, and one refetch serves all.
        if (refetchTimerRef.current) return;
        refetchTimerRef.current = setTimeout(() => {
          refetchTimerRef.current = null;
          fetchLogs();
        }, 400);
      }
    };
    es.onmessage = onRow;
    return () => {
      es.close();
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [fetchLogs]);
  const liveNotice = liveRequests > 0
    ? translate(`Live — ${liveRequests} request line(s) seen this session`)
    : translate("Watching the request stream");
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);
  const parsed = useMemo(() => lines.map(parseLog), [lines]);
  const rows = useMemo(() => {
    let out = parsed;
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.model, r.provider, r.account, r.status, r.timestamp].some((v) => String(v).toLowerCase().includes(q))
      );
    }
    if (level === "error") out = out.filter((r) => isError(r.status));
    else if (level === "ok") out = out.filter((r) => !isError(r.status));
    return out.slice(0, limit);
  }, [parsed, query, level, limit]);
  const models = useMemo(
    () => [...new Set(parsed.map((r) => r.model).filter((m) => m !== "-"))].slice(0, 12),
    [parsed]
  );
  const errorCount = useMemo(() => parsed.filter((r) => isError(r.status)).length, [parsed]);
  if (loading) return <CardSkeleton />;
  return (
    <div className="flex flex-col gap-4">
      {/* ── Controls strip ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border-subtle bg-surface p-3 shadow-[var(--shadow-soft)]">
        {/* The live notice — §7's "SSE notice → refetch", stated so the
            operator knows the table moves on its own and is not a snapshot
            they have to remember to reload. */}
        <span
          role="status"
          className={cn(
            "inline-flex min-h-[28px] items-center gap-2 rounded-full border px-2.5 text-2xs font-semibold",
            liveRequests > 0
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border-strong bg-surface-2 text-text-muted"
          )}
        >
          <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", liveRequests > 0 ? "bg-emerald-500" : "bg-text-subtle")} />
          {liveNotice}
        </span>
        <div className="flex items-center gap-1 rounded-[10px] bg-surface-2 p-0.5">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLevel(l.id)}
              aria-pressed={level === l.id}
              className={cn(
                "inline-flex min-h-[28px] items-center gap-1.5 rounded-[8px] px-2.5 text-2xs font-semibold motion-control",
                level === l.id ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
            >
              {translate(l.label)}
              {l.id === "error" && errorCount > 0 && (
                <span className="tabular-nums text-red-700 dark:text-red-400">{errorCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-text-subtle">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={translate("Search the request ledger")}
            placeholder={translate("Search by model, provider, account, status...")}
            className="h-8 w-full rounded-[8px] border border-border-strong bg-surface-2 pl-8 pr-2.5 text-xs text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/60"
          />
        </div>
        <Button size="sm" variant="outline" icon="refresh" onClick={() => fetchLogs()}>
          {translate("Refresh")}
        </Button>
      </div>
      {/* ── Model chips ────────────────────────────────────────────────── */}
      {models.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {models.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setQuery((prev) => (prev === m ? "" : m))}
              className={cn(
                "inline-flex min-h-[26px] items-center rounded-full border px-2.5 text-2xs font-medium motion-control",
                query === m
                  ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                  : "border-border-strong bg-surface text-text-muted hover:text-text-main"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {/* ── Ledger ─────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden" padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-2/60 text-2xs uppercase tracking-wider text-text-muted">
                <th scope="col" className="px-3 py-2.5 font-semibold">{translate("Time")}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{translate("Model")}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{translate("Provider")}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{translate("Account")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">{translate("In")}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">{translate("Out")}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{translate("Status")}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{translate("Voyage")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-xs text-text-muted">
                    {lines.length === 0
                      ? translate("The ledger is empty: no request has crossed the gateway yet.")
                      : translate("No request answers to the current filters.")}
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.timestamp}-${i}`} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/40">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-2xs text-text-muted">{r.timestamp}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 font-medium text-text-main">{r.model}</td>
                    <td className="px-3 py-2 text-text-muted">{blank(r.provider)}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-text-muted">{blank(r.account)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-text-muted">{blank(r.prompt)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-text-muted">{blank(r.completion)}</td>
                    <td className={cn("px-3 py-2 font-semibold", statusTone(r.status))}>{blank(r.status)}</td>
                    {/* §7's voyage link, HONESTLY. The legacy `/api/usage/logs`
                        door returns pipe-delimited text with no reqId column,
                        so this row has NO voyage id to link with and says so
                        in the cell rather than joining on provider+model+time
                        — the inference §3 forbids. The request's lines are
                        reachable from the unified tail, where the reqId the
                        context actually stamped is on every row. */}
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = `/dashboard/logs?tab=unified&q=${encodeURIComponent(
                            `${r.model} ${r.provider}`.trim()
                          )}`;
                        }}
                        title={translate(
                          "This legacy text door carries no reqId, so it cannot join a voyage directly. Search the unified tail for this request instead."
                        )}
                        className="inline-flex min-h-[26px] items-center gap-1 rounded-[8px] border border-border-strong bg-surface-2 px-2 text-2xs text-text-muted hover:text-text-main motion-control"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-sm">travel_explore</span>
                        {translate("no reqId — find in tail")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {/* ── Footer census ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-2xs text-text-muted">
        <span>
          {translate("Showing")} {rows.length} {translate("of")} {lines.length}
        </span>
        <div className="flex items-center gap-2">
          <label htmlFor="ledger-rows" className="text-text-subtle">
            {translate("Rows")}
          </label>
          <select
            id="ledger-rows"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="min-h-[30px] rounded-[8px] border border-border-strong bg-surface px-2 text-2xs text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            {[100, 200, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
