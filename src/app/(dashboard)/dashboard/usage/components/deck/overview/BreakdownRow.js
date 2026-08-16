// Usage Observatory W2-C — Row D: the breakdown panels (sealed plan Deck-1
// row 4). TopProviders bars · TopModels bars (cost-ranked — the deck asks
// "where did the money go?") · StatusMix donut. Bars click-to-filter into
// the Needle; a donut slice sets the status facet AND crosses to the
// Requests deck pre-filtered (sealed spec: "slice → Requests pre-filtered").
// Titles compose from the shared metric labels — the i18n budget stays at 40.
"use client";

import { useMemo, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import Card from "@/shared/components/Card";
import { useMetrics } from "../../../hooks/useMetrics";
import { t } from "../../../lib/t";
import { statusClassOptions } from "../../../lib/statusOptions";
import { STATUS_COLORS } from "../../../lib/statusColors";

const fmt = (n) => new Intl.NumberFormat().format(Math.round(n || 0));
const fmtCost = (n) => (!n || n <= 0 ? "$0.00" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

const tooltipStyle = {
  backgroundColor: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
};

function BarPanel({ title, subtitle, items, maxValue, renderValue, onItemClick, activeKey }) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4" padding="none">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</span>
      <span className="-mt-1 text-[11px] text-text-muted/70">{subtitle}</span>
      {!items.length ? (
        <div className="flex h-32 items-center justify-center text-sm text-text-muted">
          {t("No data for this period")}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => {
            const width = maxValue > 0 ? Math.max(2, (it.value / maxValue) * 100) : 0;
            const active = activeKey === it.key;
            return (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => onItemClick(it.key)}
                  className="group w-full text-left"
                  title={it.key}
                >
                  <span className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
                    <span className={`truncate ${active ? "font-semibold text-primary" : "text-text"}`}>
                      {it.key || "—"}
                    </span>
                    <span className="shrink-0 tabular-nums text-text-muted" data-i18n-skip="true">
                      {renderValue(it.value)}
                    </span>
                  </span>
                  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                    <span
                      className={`block h-full rounded-full transition-all ${active ? "bg-primary" : "bg-primary/50 group-hover:bg-primary/75"}`}
                      style={{ width: `${width}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const TOP_N_BARS = 8;

function BreakdownBars({ compass, dimension }) {
  const { data } = useMetrics("breakdown", compass.metricsQuery, `dimension=${dimension}&metric=cost`);

  const items = useMemo(
    () =>
      (data?.items || [])
        .slice(0, TOP_N_BARS)
        .map((row) => ({ key: row[dimension] || "", value: row.value || 0 })),
    [data, dimension]
  );
  const maxValue = items.length ? Math.max(...items.map((i) => i.value)) : 0;

  const activeKey = dimension === "provider" ? compass.provider : compass.model;
  const onItemClick = useCallback(
    (key) => {
      const facet = dimension === "provider" ? "provider" : "model";
      compass.setFacet(facet, activeKey === key ? "" : key);
    },
    [compass, dimension, activeKey]
  );

  return (
    <BarPanel
      title={t("Est. Cost")}
      subtitle={dimension === "provider" ? t("All providers") : t("All models")}
      items={items}
      maxValue={maxValue}
      renderValue={fmtCost}
      onItemClick={onItemClick}
      activeKey={activeKey}
    />
  );
}

function StatusMixDonut({ compass }) {
  const { data } = useMetrics("breakdown", compass.metricsQuery, "dimension=statusClass&metric=requests");

  const slices = useMemo(() => {
    const labelOf = Object.fromEntries(statusClassOptions.map((o) => [o.value, o.label]));
    return (data?.items || [])
      .filter((row) => (row.value || 0) > 0)
      .map((row) => ({
        status: row.statusClass || "",
        name: labelOf[row.statusClass] || row.statusClass || "—",
        value: row.value || 0,
      }));
  }, [data]);

  const total = slices.reduce((a, s) => a + s.value, 0);

  // Slice → Requests pre-filtered: set the status facet, cross to the deck.
  const onSliceClick = useCallback(
    (status) => {
      if (!status) return;
      compass.setFacet("status", status);
      compass.setTab("requests");
    },
    [compass]
  );

  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4" padding="none">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t("Status mix")}</span>
      {!slices.length ? (
        <div className="flex h-[180px] items-center justify-center text-sm text-text-muted">
          {t("No data for this period")}
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-[180px] w-[180px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [fmt(value), name]} />
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="none"
                  onClick={(entry) => onSliceClick(entry?.payload?.status ?? entry?.status)}
                >
                  {slices.map((s) => (
                    <Cell
                      key={s.status}
                      fill={STATUS_COLORS[s.status] || "#64748b"}
                      className="cursor-pointer"
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-1">
            {slices.map((s) => (
              <li key={s.status}>
                <button
                  type="button"
                  onClick={() => onSliceClick(s.status)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-bg-subtle"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[s.status] || "#64748b" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-text-muted" data-i18n-skip="true">
                    {total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : "0%"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default function BreakdownRow({ compass }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <BreakdownBars compass={compass} dimension="provider" />
      <BreakdownBars compass={compass} dimension="model" />
      <StatusMixDonut compass={compass} />
    </div>
  );
}
