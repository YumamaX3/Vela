"use client";

// The category rail: every bucket a key can live in, with its count, in one
// column that never moves. It replaces the chip row the old card carried — the
// chips grew sideways with every new category and pushed the fleet off-screen,
// while a rail grows downward and keeps the rows anchored.
//
// The counts come from the census when it answered, and from the rows in hand
// while it is in flight (see useKeyDeck.railCounts) — the two are the same
// number computed the same way, so the rail never flashes a wrong total.
import { translate } from "@/i18n/runtime";
import { UNCATEGORIZED } from "../../lib/keyFormat";

function Row({ active, onClick, icon, label, count, title }) {
  return (
    <button
      onClick={onClick}
      title={title || label}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[10px] text-left motion-control ${
        active
          ? "bg-primary/15 text-primary font-semibold"
          : "text-text-muted hover:text-text-main hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      }`}
    >
      {icon && <span className="material-symbols-outlined text-[16px] shrink-0">{icon}</span>}
      <span className="flex-1 min-w-0 truncate text-xs">{label}</span>
      <span className="text-[11px] tabular-nums shrink-0">{count}</span>
    </button>
  );
}

export default function KeyRail({ c, deck }) {
  const { categories, keys } = c;
  const { railCounts, activeCategoryFilter, setActiveCategoryFilter } = deck;

  const hasUncategorized = keys.some((k) => !k.category);

  return (
    <nav className="flex flex-col gap-1" aria-label={translate("Key categories")}>
      <p className="text-[10px] uppercase tracking-wide text-text-muted px-2.5 mb-1">
        {translate("Categories")}
      </p>

      <Row
        active={activeCategoryFilter === "all"}
        onClick={() => setActiveCategoryFilter("all")}
        icon="inventory_2"
        label={translate("All keys")}
        count={railCounts.total}
      />

      {categories.map((cat) => (
        <Row
          key={cat}
          active={activeCategoryFilter === cat}
          onClick={() => setActiveCategoryFilter(cat)}
          icon="label"
          label={cat}
          count={railCounts.of(cat)}
        />
      ))}

      {hasUncategorized && (
        <Row
          active={activeCategoryFilter === UNCATEGORIZED}
          onClick={() => setActiveCategoryFilter(UNCATEGORIZED)}
          icon="label"
          label={translate("Uncategorized")}
          count={railCounts.of(UNCATEGORIZED)}
          title={translate("Keys with no category")}
        />
      )}
    </nav>
  );
}
