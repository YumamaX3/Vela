"use client";

// The table lens — the same fleet, read across instead of down. For an operator
// comparing ceilings or hunting the one key that is carrying the load, a column
// is faster than a card; for reading one key's story, the card wins. Neither is
// the "real" view, which is why both exist and both read the same marks.
//
// The rows are the deck's own sorted, filtered list — the table never re-sorts,
// so the header's arrow and the row order can never disagree.
import { translate } from "@/i18n/runtime";
import { formatCost, formatTokens, postureOf, timeAgo } from "../../lib/keyFormat";
import { PosturePill, SelectBox } from "./KeyBits";

const HEAD = [
  { id: "name", label: "Key" },
  { id: "category", label: "Category" },
  { id: "scope", label: "Scope" },
  { id: "ceiling", label: "Ceilings" },
  { id: "requests", label: "Requests" },
  { id: "tokens", label: "Tokens" },
  { id: "cost", label: "Spend" },
  { id: "lastUsed", label: "Last used" },
];

export default function KeyTable({ deck }) {
  const { visibleKeys, selected, toggleSelect, selectAllVisible, clearSelection, keyUsage, setSortKey, sortKey, sortDir, openDetail, setActive, revoke } = deck;

  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k.id));

  const scopeOf = (k) => (Array.isArray(k.allowedModels) && k.allowedModels.length > 0 ? `${k.allowedModels.length}` : translate("All"));
  const ceilingsOf = (k) => {
    const parts = [];
    if (k.rateLimitRpm != null) parts.push(`${k.rateLimitRpm} RPM`);
    if (k.tokenBudgetDaily != null) parts.push(`${formatTokens(k.tokenBudgetDaily)} tok`);
    if (k.spendCapDailyCents != null) parts.push(`$${(k.spendCapDailyCents / 100).toFixed(0)}`);
    if (k.ipAllowlist?.length) parts.push(`${k.ipAllowlist.length} IP`);
    return parts.length > 0 ? parts.join(" · ") : "—";
  };

  const sortArrow = (id) =>
    sortKey === id ? (
      <span className="material-symbols-outlined text-[12px] align-middle">
        {sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
      </span>
    ) : null;

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-3 w-8">
              <SelectBox
                checked={allSelected}
                onChange={(next) => (next ? selectAllVisible() : clearSelection())}
                title={translate("Select every key currently visible")}
              />
            </th>
            {HEAD.map((col) => (
              <th key={col.id} className="py-2 pr-3 text-[11px] uppercase tracking-wide text-text-muted font-semibold whitespace-nowrap">
                <button
                  onClick={() => {
                    if (["name", "requests", "tokens", "cost", "lastUsed"].includes(col.id)) {
                      setSortKey(col.id);
                    }
                  }}
                  className={`inline-flex items-center gap-1 motion-control ${
                    ["name", "requests", "tokens", "cost", "lastUsed"].includes(col.id) ? "hover:text-primary" : "cursor-default"
                  }`}
                  title={["name", "requests", "tokens", "cost", "lastUsed"].includes(col.id) ? translate("Sort by this column") : undefined}
                >
                  {translate(col.label)}
                  {sortArrow(col.id)}
                </button>
              </th>
            ))}
            <th className="py-2 text-[11px] uppercase tracking-wide text-text-muted font-semibold text-right">
              {translate("Actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleKeys.map((k) => {
            const usage = keyUsage[k.id] || {};
            const posture = postureOf(k);
            const paused = posture === "paused";
            return (
              <tr
                key={k.id}
                className={`border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${
                  paused ? "opacity-60" : ""
                }`}
              >
                <td className="py-2.5 pr-3">
                  <SelectBox
                    checked={selected.has(k.id)}
                    onChange={(next) => toggleSelect(k.id, next)}
                    title={translate("Select this key")}
                  />
                </td>
                <td className="py-2.5 pr-3 min-w-[180px]">
                  <button
                    onClick={() => openDetail(k.id)}
                    className="text-sm font-medium hover:text-primary motion-control text-left"
                  >
                    {k.name}
                  </button>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <PosturePill posture={posture} />
                    <code className="text-[11px] text-text-muted font-mono">{k.keyPrefix}</code>
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-xs text-text-muted whitespace-nowrap">{k.category || "—"}</td>
                <td className="py-2.5 pr-3 text-xs text-text-muted whitespace-nowrap">{scopeOf(k)}</td>
                <td className="py-2.5 pr-3 text-xs text-text-muted whitespace-nowrap">{ceilingsOf(k)}</td>
                <td className="py-2.5 pr-3 text-xs tabular-nums whitespace-nowrap">
                  {Number(usage.requests || 0).toLocaleString()}
                </td>
                <td className="py-2.5 pr-3 text-xs tabular-nums text-text-muted whitespace-nowrap">
                  {formatTokens(usage.totalTokens || 0)}
                </td>
                <td className="py-2.5 pr-3 text-xs tabular-nums text-text-muted whitespace-nowrap">
                  {formatCost(usage.cost)}
                </td>
                <td className="py-2.5 pr-3 text-xs text-text-muted whitespace-nowrap">
                  {k.lastUsedAt ? timeAgo(k.lastUsedAt) : translate("Never")}
                </td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => setActive([k.id], !(k.isActive ?? true))}
                    className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary motion-control"
                    title={k.isActive ? translate("Pause key") : translate("Resume key")}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {k.isActive ? "block" : "check_circle"}
                    </span>
                  </button>
                  <button
                    onClick={() => revoke([k.id])}
                    className="p-1.5 hover:bg-red-500/10 rounded text-red-500 motion-control"
                    title={translate("Delete (revoke)")}
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
