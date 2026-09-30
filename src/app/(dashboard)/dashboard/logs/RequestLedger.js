"use client";
// Request Ledger — every request that crossed the gateway, in one ledger.
//
// Carried from the v0.9.44 Request Logs room, re-homed into the Log Harbor and
// re-inked to the house tokens. The data source is unchanged — the pipe-
// delimited lines /api/usage/logs has always returned.
import { useState, useEffect, useMemo, useCallback } from "react";
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-xs text-text-muted">
                    {lines.length === 0
                      ? translate("The ledger is empty — no request has crossed the gateway yet.")
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
