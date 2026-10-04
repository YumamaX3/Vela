// VoyageView — §7's voyage view. One request's whole life, in arrival order.
//
// ── WHAT IT JOINS ON, AND ONLY THAT ─────────────────────────────────────────
// §7: "every row sharing its `reqId` in arrival order (keyset on ix_log_req),
// ledger row (usageHistory by reqId) pinned, per-call upstreamIds listed. Joins
// on `reqId` ONLY (§3 authority)."
//
// §3's authority is the AsyncLocalStorage voyage context: the reqId is minted
// at the handler entry and stamped onto lines that pass through console.* or
// the container tap INSIDE it. A line written outside any voyage (a foreign
// child-process write, a line from a foreign module that escaped the tap) has
// NO reqId, and §3 says those are unjoinable — never inferred from a timestamp
// neighbourhood, never guessed from a tag. So:
//
//   · reqId present  → query the events door with `reqId`, render the rows.
//   · reqId absent   → render the HONEST unjoinable state. Not an empty panel,
//     not a "no rows" — a named explanation of why this line cannot be joined.
//
// ── THE LEDGER ROW, STATED HONESTLY ─────────────────────────────────────────
// §7 asks for the usageHistory row pinned by reqId. There is NO door that
// joins usageHistory by reqId: `/api/usage/logs` returns pipe-delimited text
// with no voyage stamp, `getUsageHistory` has no reqId filter, and `idx_uh_reqId`
// exists on the index but nothing queries through it. So this drawer states
// that plainly — "ledger join pending" with the reason — rather than
// (a) inventing a door outside M9's scope, or (b) faking a join against
// provider+model+timestamp, which is the exact inference §3 forbids. When the
// door lands, this is the one line that changes.
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Drawer } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";
import LogRow, { formatMeta, formatRowTime, levelName, levelTone, rowKey } from "./LogRow";

const VOYAGE_PAGE = 200;

/** Group rows by their upstreamId, keeping arrival order in each group. */
function upstreamCalls(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = row.upstreamId;
    const key = id ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

export default function VoyageView({ row, isOpen, onClose }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reqId = row?.reqId ?? null;

  const fetchPage = useCallback(
    async (before) => {
      const params = new URLSearchParams({ limit: String(VOYAGE_PAGE) });
      if (reqId) params.set("reqId", reqId);
      if (before) params.set("before", String(before));
      const res = await fetch(`/api/logs/events?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `The voyage door answered ${res.status}.`);
      }
      const data = await res.json();
      return data;
    },
    [reqId]
  );

  // A new voyage re-sails from the newest page. ASCENDING is what §7 asks for
  // ("in arrival order"), and the events door returns DESC, so the first page
  // is reversed once here and every later page is appended ahead of it.
  useEffect(() => {
    if (!isOpen) return;
    // §3's authority, and the reason for this guard: a row with no reqId has
    // NO voyage to ask the door about. Fetching anyway would issue
    // `/api/logs/events?limit=200` with no narrowing at all and paint whatever
    // the whole ledger happened to return — the tail rendered as if it
    // belonged to this line. That is the guess §3 forbids, so the unjoinable
    // path asks nothing.
    if (!reqId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    setHasMore(false);
    fetchPage(null)
      .then((data) => {
        if (cancelled) return;
        const page = Array.isArray(data.rows) ? [...data.rows].reverse() : [];
        setRows(page);
        setCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.hasMore));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, reqId, fetchPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading || cursor === null) return;
    setLoading(true);
    fetchPage(cursor)
      .then((data) => {
        const page = Array.isArray(data.rows) ? [...data.rows].reverse() : [];
        setRows((prev) => [...prev, ...page]);
        setCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.hasMore));
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [cursor, hasMore, loading, fetchPage]);

  const upstreamGroups = useMemo(() => upstreamCalls(rows), [rows]);

  const ledgerSlot = useMemo(() => {
    // §7's pinned usageHistory row. Named, not rendered: no door joins it.
    if (!reqId) return { state: "unjoinable" };
    return { state: "pending" };
  }, [reqId]);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={translate("Voyage")} width="lg">
      <div className="flex flex-col gap-4">
        {/* ── The voyage identity ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-2xs font-semibold",
              levelTone(row?.lvl).hud
            )}
          >
            {levelName(row?.lvl)}
          </span>
          {row?.stream && (
            <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-text-muted">
              {row.stream}
            </span>
          )}
          {row?.provider && (
            <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-text-muted">
              {row.provider}
            </span>
          )}
          <span className="font-mono text-2xs text-text-subtle">{formatRowTime(row?.ts)}</span>
        </div>

        {/* ── Unjoinable, said plainly ─────────────────────────────────── */}
        {!reqId ? (
          <div className="rounded-[10px] border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {translate("This line is unjoinable")}
            </p>
            <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
              {translate(
                "It carries no reqId, so there is no voyage to join it to. §3 stamps the request id only on lines written inside a live voyage; a foreign process write, or a line from a module that bypassed the tap, has none. The harbor will not guess one."
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
              <dt className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                {translate("Voyage id")}
              </dt>
              <dd className="mt-1 break-all font-mono text-xs text-text-main">{reqId}</dd>
            </div>

            {/* ── THE PINNED LEDGER ROW, HONESTLY ─────────────────────── */}
            <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
              <p className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                {translate("Usage ledger row")}
              </p>
              {ledgerSlot.state === "pending" ? (
                <p className="mt-1 text-xs text-text-muted">
                  {translate("Ledger join pending.")}{" "}
                  {translate(
                    "No door joins usageHistory by reqId yet — /api/usage/logs returns pipe-delimited text with no voyage stamp. Rather than join on provider+model+timestamp (a guess §3 forbids), the harbor leaves this slot honestly empty until that door lands."
                  )}
                </p>
              ) : (
                <p className="mt-1 text-xs text-text-muted">{translate("No voyage to join.")}</p>
              )}
            </div>

            {/* ── Per-call upstreamIds, in arrival order ───────────────── */}
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                {translate("Upstream calls")} ({upstreamGroups.size})
              </p>
              {upstreamGroups.size === 0 ? (
                <p className="text-xs text-text-muted">{translate("No upstream calls recorded.")}</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {[...upstreamGroups.entries()].map(([upstreamId, group]) => (
                    <li
                      key={upstreamId ?? "none"}
                      className="rounded-[10px] border border-border-subtle bg-surface-2 p-2.5"
                    >
                      <p className="break-all font-mono text-2xs text-text-main">
                        {upstreamId ?? translate("no upstreamId on these lines")}
                      </p>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {group.map((r) => (
                          <li key={rowKey(r)} className="flex items-baseline gap-2 text-2xs text-text-muted">
                            <span className="tabular-nums text-text-subtle">{formatRowTime(r.ts)}</span>
                            <span className={cn("font-semibold", levelTone(r.lvl).term)}>{levelName(r.lvl)}</span>
                            <span className="min-w-0 flex-1 truncate">{r.msg}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}

        {/* ── The voyage's rows, in arrival order ────────────────────── */}
        {reqId && (
          <div>
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
              {translate("Lines in this voyage")} ({rows.length})
            </p>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {rows.length === 0 && !loading && !error && (
              <p className="text-xs text-text-muted">
                {translate("No lines share this reqId yet — the voyage may still be in flight.")}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {rows.map((r) => (
                <li
                  key={rowKey(r)}
                  className="rounded-[8px] border border-border-subtle bg-surface-2 px-2 py-1"
                >
                  <div className="flex items-baseline gap-2 font-mono text-2xs">
                    <span className="tabular-nums text-text-subtle">{formatRowTime(r.ts)}</span>
                    <span className={cn("font-semibold", levelTone(r.lvl).term)}>{levelName(r.lvl)}</span>
                    <span className="text-text-subtle">{r.stream}</span>
                    {r.tag ? <span className="text-text-subtle">[{r.tag}]</span> : null}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs text-text-main">
                    {r.msg}
                  </p>
                </li>
              ))}
            </ul>
            {hasMore && (
              <Button size="sm" variant="outline" icon="expand_more" onClick={loadMore} loading={loading} className="mt-2 self-start">
                {translate("Older lines")}
              </Button>
            )}
          </div>
        )}

        {/* ── The clicked row's own meta ──────────────────────────────── */}
        {formatMeta(row?.meta) && (
          <div>
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
              {translate("Meta")}
            </p>
            <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[var(--color-terminal)] p-3 font-mono text-xs leading-relaxed text-[var(--color-terminal-text)]">
              {formatMeta(row.meta)}
            </pre>
          </div>
        )}
      </div>
    </Drawer>
  );
}