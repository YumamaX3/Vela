// Usage Observatory W2-C — Row E: Top Spenders (sealed plan Deck-1 row 5).
// UsageTable.js reused with localStorage expansion kept, fed by the same
// useUsageStream subscription the Overview deck owns (stats.byApiKey —
// period-aware). The deck asks "where did the money go?", so the default
// sort is cost-descending and the table rides cost view only.
"use client";

import { useState, useMemo, useCallback } from "react";
import Badge from "@/shared/components/Badge";
import UsageTable, { fmt, fmtTime } from "../../UsageTable";
import { sortData, groupDataByKey } from "../../../lib/usageGrouping";
import { t } from "../../../lib/t";

const SPENDER_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

export default function SpendersRow({ stats }) {
  const [sortBy, setSortBy] = useState("cost");
  const [sortOrder, setSortOrder] = useState("desc");

  const onToggleSort = useCallback((tableType, field) => {
    if (field === sortBy) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  }, [sortBy]);

  const groupedData = useMemo(() => {
    if (!stats?.byApiKey) return [];
    return groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName");
  }, [stats, sortBy, sortOrder]);

  return (
    <UsageTable
      title={t("Top Spenders")}
      columns={SPENDER_COLUMNS}
      groupedData={groupedData}
      tableType="spenders"
      sortBy={sortBy}
      sortOrder={sortOrder}
      onToggleSort={onToggleSort}
      viewMode="costs"
      storageKey="usage-observatory:expanded-spenders"
      renderSummaryCells={(group) => (
        <>
          <td className="px-6 py-3 text-text-muted">—</td>
          <td className="px-6 py-3 text-text-muted">—</td>
          <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
          <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
        </>
      )}
      renderDetailCells={(item) => (
        <>
          <td className="px-6 py-3 font-medium">{item.keyName}</td>
          <td className="px-6 py-3">{item.rawModel}</td>
          <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
          <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
          <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
        </>
      )}
      emptyMessage="No usage recorded yet."
    />
  );
}
