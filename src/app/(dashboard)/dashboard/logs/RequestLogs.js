"use client";
// Request Logs — the full request ledger (System category).
// Fetches /api/usage/logs (pipe-delimited log lines) and renders them as a
// filterable, searchable table: time · model · provider · account · in · out · status.
// Warm-dark 9router blend, real data only.
import { useState, useEffect, useMemo, useCallback } from "react";
import Card from "@/shared/components/Card";
import { CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";

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

function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("ok") || s === "200" || s === "success" || s.includes("2")) return "text-success";
  if (s.includes("err") || s === "500" || s === "429" || s === "403" || s === "400" || s.startsWith("4") || s.startsWith("5")) return "text-danger";
  if (s === "-" || !s) return "text-text-subtle";
  return "text-warning";
}

const LEVELS = ["All", "OK", "Error"];

export default function RequestLogs() {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("All");
  const [limit, setLimit] = useState(200);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/logs");
      if (res.ok) {
        const data = await res.json();
        setLines(Array.isArray(data) ? data : []);
      }
    } catch {
      // fail-open
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const rows = useMemo(() => {
    let out = lines.map(parseLog);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.model, r.provider, r.account, r.status, r.timestamp].some((v) => String(v).toLowerCase().includes(q))
      );
    }
    if (level !== "All") {
      const isErr = (s) => /err|4\d\d|5\d\d|429|403|400/.test(String(s));
      out = out.filter((r) => (level === "Error" ? isErr(r.status) : !isErr(r.status)));
    }
    return out.slice(0, limit);
  }, [lines, query, level, limit]);

  const models = useMemo(() => [...new Set(lines.map(parseLog).map((r) => r.model).filter((m) => m !== "-"))].slice(0, 12), [lines]);

  if (loading) return <CardSkeleton />;

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">{translate("Request Logs")}</h1>
          <p className="text-sm text-text-muted mt-1">{translate("Every request that crossed the gateway, in one ledger")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button
            type="button"
            onClick={() => fetchLogs()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-main hover:bg-surface-2"
          >
            <span className="material-symbols-outlined text-[15px] text-primary">refresh</span>
            {translate("Refresh")}
          </button>
        </div>
      </div>

      {/* Search + model chips */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-subtle">search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={translate("Search by model, provider, account, status...")}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-main placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {models.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setQuery(m)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  query === m ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-surface text-text-muted hover:text-text-main"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden" padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-2/60 text-[10.5px] uppercase tracking-wider text-text-subtle">
                <th className="px-3 py-2.5 font-semibold">{translate("Time")}</th>
                <th className="px-3 py-2.5 font-semibold">{translate("Model")}</th>
                <th className="px-3 py-2.5 font-semibold">{translate("Provider")}</th>
                <th className="px-3 py-2.5 font-semibold">{translate("Account")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{translate("In")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{translate("Out")}</th>
                <th className="px-3 py-2.5 font-semibold">{translate("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-xs text-text-subtle">
                    {translate("No requests in the log yet")}
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/40">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-text-subtle">{r.timestamp}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 font-medium text-text-main">{r.model}</td>
                    <td className="px-3 py-2 text-text-muted">{r.provider}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-text-muted">{r.account}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11.5px] text-text-muted">{r.prompt}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11.5px] text-text-muted">{r.completion}</td>
                    <td className={`px-3 py-2 font-medium ${statusTone(r.status)}`}>{r.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between text-[11px] text-text-subtle">
        <span>{translate("Showing")} {rows.length} {translate("of")} {lines.length}</span>
        <div className="flex items-center gap-2">
          <span>{translate("Rows")}</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded border border-border bg-surface px-2 py-0.5 text-[11px] text-text-main"
          >
            {[100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
