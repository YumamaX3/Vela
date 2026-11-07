"use client";
// KeysClient — the Keys shore: the fleet itself, minted, filed, scoped, capped,
// paused and revoked (sealed plan §3.1 · W3).
//
// WHAT MOVED: the composition the old KeysCard held — the masthead (with the
// `#require-api-key` anchor the deep link resolves through), the fleet pulse,
// the rail, the toolbar, the two lenses, the drawer and the import ceremony.
// VERBATIM (R-31): same furniture, same deck, same expressions. What changed is
// the address and the frame around it.
//
// WHAT IS NEW (the plan's two Keys features):
//   · the quick-actions bar is now ALWAYS MOUNTED — when nothing is selected it
//     offers the fleet-level acts, when a selection exists it shows the
//     per-selection acts. One bar, two modes, no second fetch path.
//   · the per-key activity chart reads the stacked usage seam over the same
//     window the deck measures over, with the honest empty state the law names.
import BulkActionBar from "../components/keys/BulkActionBar";
import KeyCard from "../components/keys/KeyCard";
import KeyDetailDrawer from "../components/keys/KeyDetailDrawer";
import KeyImportModal from "../components/keys/KeyImportModal";
import KeyRail from "../components/keys/KeyRail";
import KeySpendView from "../components/keys/KeySpendView";
import KeyTable from "../components/keys/KeyTable";
import KeyToolbar from "../components/keys/KeyToolbar";
import KeysMasthead from "../components/keys/KeysMasthead";
import EndpointShore from "../components/EndpointShore";
import KeyActivityChart from "../components/keys/KeyActivityChart";
import { Button, Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { useEndpointFacade } from "../hooks/useEndpointFacade";
import useKeyDeck from "../hooks/useKeyDeck";

const NOTICE_TONE = {
  ok: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  red: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
};

export default function KeysClient() {
  const c = useEndpointFacade();
  const deck = useKeyDeck(c);
  const { keys, openCreateModal } = c;

  const filtersActive = Boolean(deck.query) || deck.activeCategoryFilter !== "all" || Boolean(deck.posture);

  const clearFilters = () => {
    deck.setQuery("");
    deck.setActiveCategoryFilter("all");
    deck.setPosture(null);
  };

  return (
    <EndpointShore
      title="API Keys"
      subtitle="The fleet: mint, file, scope, ceiling, pause and revoke — with the usage each key has earned."
      icon="vpn_key"
      error={c.error}
      onRetry={c.reload}
      loading={c.loading}
    >
      <div className="flex flex-col gap-4">
        <KeysMasthead c={c} deck={deck} />

        {deck.notice && (
          <div className={`flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs ${NOTICE_TONE[deck.notice.tone] || NOTICE_TONE.warn}`}>
            <span className="material-symbols-outlined text-sm mt-0.5">info</span>
            <span className="flex-1 whitespace-pre-line">{deck.notice.message}</span>
            <button
              onClick={() => deck.setNotice(null)}
              className="motion-control opacity-70 hover:opacity-100"
              title={translate("Dismiss")}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        <Card>
          <KeyToolbar deck={deck} />

          {keys.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
                <span className="material-symbols-outlined text-3xl">vpn_key</span>
              </div>
              <p className="text-text-main font-medium mb-1">{translate("No API keys yet")}</p>
              <p className="text-sm text-text-muted mb-4">{translate("Create your first API key to get started")}</p>
              <Button icon="add" onClick={openCreateModal}>
                {translate("Create Key")}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] gap-4 mt-4">
              <div className="lg:border-r lg:border-border lg:pr-3">
                <KeyRail c={c} deck={deck} />
              </div>

              <div className="min-w-0">
                {deck.visibleKeys.length === 0 ? (
                  <div className="text-center py-10">
                    <p className="text-sm text-text-main mb-1">
                      {filtersActive ? translate("No key matches this view") : translate("Nothing to show")}
                    </p>
                    <p className="text-xs text-text-muted mb-3">
                      {filtersActive
                        ? translate("The fleet has keys — the current filters exclude them all.")
                        : translate("Every key is hidden from this view.")}
                    </p>
                    {filtersActive && (
                      <Button variant="outline" size="sm" icon="close" onClick={clearFilters}>
                        {translate("Clear filters")}
                      </Button>
                    )}
                  </div>
                ) : deck.lens === "table" ? (
                  <KeyTable deck={deck} />
                ) : (
                  <div className="flex flex-col">
                    {deck.visibleKeys.map((k) => (
                      <KeyCard key={k.id} k={k} deck={deck} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* The fleet's traffic over the window every strip is measured over. */}
        <KeyActivityChart c={c} deck={deck} />

        {/* Where the money went, per key, over the same window. */}
        <KeySpendView c={c} deck={deck} />

        <BulkActionBar deck={deck} onCreateKey={openCreateModal} />

        {deck.detailKey && (
          <KeyDetailDrawer key={deck.detailKey.id} k={deck.detailKey} deck={deck} />
        )}

        <KeyImportModal deck={deck} />
      </div>
    </EndpointShore>
  );
}
