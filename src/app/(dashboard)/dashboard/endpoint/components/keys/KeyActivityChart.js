"use client";
// KeyActivityChart — the fleet's traffic, per key, over the window every strip
// on this shore is measured over (sealed plan §3.1 · W3, the per-key activity
// chart).
//
// WHY IT EXISTS: the deck's rows showed each key's TOTAL usage for the window,
// but nothing showed the SHAPE — whether a key is used steadily, in bursts, or
// not at all. That shape is what tells an operator which key to pause and which
// to keep, and it was already on the wire: the stacked usage seam answers
// per-key series when asked for the keyId dimension.
//
// THE SEAM: `/api/usage/metrics/stacked?dimension=keyId&period=<window>&metric=requests&gran=1h|1d`.
// It returns `{ series: [{ key, total, points: [{ t, value }] }] }` — the same
// enrichment the usage page's own chart reads, so the series names are the
// route's own key labels, never a raw id invented here.
//
// THE EMPTY-STATE LAW: zero series renders "No traffic in this window", never
// an empty frame — an empty chart is a rendering failure dressed as a reading.
// A failed read says "could not be read", never a fabricated zero: "nothing
// happened" and "I could not look" are different truths, and a flat line at
// zero would blur them.
import { useEffect, useState } from "react";
import { translate } from "@/i18n/runtime";
import { PERIODS } from "../../hooks/useKeyDeck";
import { Card } from "@/shared/components";

/** The window's granularity — hourly inside a day, daily beyond it. The seam
 *  accepts both; the choice is the window's own resolution, not a preference. */
function granFor(period) {
  if (period === "24h") return "1h";
  return "1d";
}

/** Format a series point's timestamp for the axis — compact, no locale drift. */
function pointLabel(t, gran) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  if (gran === "1h") {
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** One key's traffic as a bar strip — height is the value, width is the window. */
function SeriesStrip({ name, points, gran, peak }) {
  const max = peak || 1;
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-border-subtle last:border-b-0">
      <span className="text-xs text-text-main truncate min-w-0 w-[140px] shrink-0" title={name}>
        {name}
      </span>
      <div className="flex-1 flex items-end gap-px h-8" role="img" aria-label={`${name}: ${points.length} points`}>
        {points.map((p, i) => (
          <div
            key={i}
            className="flex-1 min-w-[2px] rounded-t motion-fill"
            style={{ height: `${Math.max((p.value / max) * 100, 3)}%`, background: "var(--color-brand-500)" }}
            title={`${pointLabel(p.t, gran)} — ${p.value}`}
          />
        ))}
      </div>
      <span className="text-2xs font-mono tabular-nums text-text-muted w-[52px] text-right shrink-0">
        {points.reduce((n, p) => n + (p.value || 0), 0)}
      </span>
    </div>
  );
}

export default function KeyActivityChart({ c, deck }) {
  const period = deck.usagePeriod;
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);

  // Period-keyed: a window change re-opens the read. The abort is the honesty
  // guard — a slow read for the previous window must never land on top of the
  // new one's shape.
  useEffect(() => {
    const controller = new AbortController();
    setSeries(null);
    setError(null);
    (async () => {
      try {
        const gran = granFor(period);
        const res = await fetch(
          `/api/usage/metrics/stacked?dimension=keyId&period=${encodeURIComponent(period)}&metric=requests&gran=${gran}`,
          { cache: "no-store", signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (controller.signal.aborted) return;
        const rows = Array.isArray(data?.series) ? data.series : [];
        // The route's own enrichment names each series; a raw id (if the
        // enrichment ever misses) resolves through the fleet in hand, and a
        // masked prefix is the last honest resort — never a printed raw id.
        const byId = new Map((c.keys || []).map((k) => [k.id, k]));
        setSeries(rows.map((s) => {
          const key = byId.get(s.key);
          const label = key?.name || key?.keyPrefix || s.key || "unknown";
          return {
            name: label,
            total: s.total || 0,
            points: Array.isArray(s.points) ? s.points : [],
          };
        }));
      } catch (err) {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setError(err?.message || "could not be read");
      }
    })();
    return () => controller.abort();
  }, [period, c.keys]);

  const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;
  const gran = granFor(period);
  const peak = series && series.length
    ? Math.max(...series.flatMap((s) => s.points.map((p) => p.value || 0)), 1)
    : 1;
  const total = series ? series.reduce((n, s) => n + s.total, 0) : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-lg text-brand-500/80" aria-hidden="true">insights</span>
          {translate("Fleet traffic")}
        </h2>
        <span className="text-2xs text-text-muted">
          {translate("Requests per key over the last")} {periodLabel.toLowerCase()}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-text-muted py-2">
          {translate("Traffic could not be read")} — {error}
        </p>
      ) : series === null ? (
        <p className="text-xs text-text-muted py-2">{translate("Reading traffic…")}</p>
      ) : series.length === 0 ? (
        <p className="text-xs text-text-muted py-2">
          {translate("No traffic in this window")}
        </p>
      ) : (
        <>
          <div className="flex flex-col">
            {series.map((s) => (
              <SeriesStrip key={s.name} name={s.name} points={s.points} gran={gran} peak={peak} />
            ))}
          </div>
          <p className="text-2xs text-text-muted mt-2 font-mono tabular-nums">
            {total} {translate("requests")} · {series.length} {series.length === 1 ? translate("key") : translate("keys")}
          </p>
        </>
      )}
    </Card>
  );
}
