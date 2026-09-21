"use client";

// The browsable lens: harbor sections, each collapsible, each with its own
// counts. Namespace order is stable; the un-namespaced harbor lands last.
import ComboCard from "./ComboCard";
import { comboHealth } from "../lib/comboGroups";

export default function ComboGrid({
  harbors,
  comboStrategies,
  usageByName,
  hub,
  getCaps,
  copied,
  selectedIds,
  onToggleSelect,
  onToggle,
  collapsed,
  onCopy,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onSetStrategy,
}) {
  const named = harbors.filter((h) => h.harbor);
  const root = harbors.find((h) => !h.harbor);

  return (
    <div className="flex flex-col gap-4">
      {[...named, ...(root ? [root] : [])].map(({ harbor, combos, members, judged, reachable }) => {
        const isRoot = !harbor;
        const isCollapsed = !!collapsed?.[harbor];

        return (
          <section key={harbor || "__root__"} className="min-w-0">
            {(named.length > 0 || !isRoot) && (
              <button
                type="button"
                onClick={() => onToggle?.(harbor)}
                aria-expanded={!isCollapsed}
                className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left motion-control hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              >
                <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">
                  {isCollapsed ? "chevron_right" : "expand_more"}
                </span>
                <span className="font-mono text-xs font-medium text-text-main">
                  {isRoot ? "No namespace" : harbor}
                </span>
                <span className="text-[11px] text-text-muted">
                  {combos.length} combo{combos.length === 1 ? "" : "s"} · {members} model{members === 1 ? "" : "s"}
                  {judged > 0 && ` · ${reachable}/${judged} connected`}
                </span>
              </button>
            )}

            {!isCollapsed && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {combos.map((combo) => (
                  <ComboCard
                    key={combo.id}
                    combo={combo}
                    strategy={comboStrategies?.[combo.name] || {}}
                    usage={usageByName?.[combo.name] || null}
                    getCaps={getCaps}
                    health={comboHealth(combo, hub)}
                    copied={copied}
                    selected={selectedIds?.has(combo.id)}
                    onToggleSelect={onToggleSelect}
                    onCopy={onCopy}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                    onSetStrategy={(patch) => onSetStrategy?.(combo.name, patch)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
