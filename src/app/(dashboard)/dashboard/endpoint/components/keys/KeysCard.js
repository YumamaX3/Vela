"use client";

// The key fleet's deck — one room, one data current, four lenses.
//
// WHAT THIS REPLACED, AND WHY (R-31, written down): the previous card was one
// scroll that had to serve five unrelated questions at once — what the harbor's
// posture is, which keys exist, how they are filed, what each one costs, and the
// acts that change them. Every visit paid for every part, the category chips
// grew sideways with every new bucket, and the ceiling editor lived in a modal
// because there was nowhere on the row to put it.
//
// Now: the masthead answers "what is this fleet" (the census, the require-key
// gate, the four fleet acts), the rail answers "how is it filed", the toolbar
// answers "what am I looking at", the two lenses answer "show me the keys", the
// drawer answers "tell me about this one", and the bulk bar answers "do this to
// all of those". Every one of them reads the same current — useKeyDeck — so no
// lens can hold a private opinion about what a key's posture is.
//
// Behavior is not merely preserved, it is single-sourced: pause, revoke, filing
// and ceilings each exist in exactly one function, and the row, the table, the
// drawer and the bulk bar all call it. That was not true before — the row and
// the delete button each carried their own copy of the confirm.
import { Button, Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import BulkActionBar from "./BulkActionBar";
import KeyCard from "./KeyCard";
import KeyDetailDrawer from "./KeyDetailDrawer";
import KeyImportModal from "./KeyImportModal";
import KeyRail from "./KeyRail";
import KeyTable from "./KeyTable";
import KeyToolbar from "./KeyToolbar";
import KeysMasthead from "./KeysMasthead";

const NOTICE_TONE = {
  ok: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  red: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
};

export default function KeysCard({ c, deck }) {
  const { keys, openCreateModal } = c;

  const filtersActive = Boolean(deck.query) || deck.activeCategoryFilter !== "all" || Boolean(deck.posture);

  const clearFilters = () => {
    deck.setQuery("");
    deck.setActiveCategoryFilter("all");
    deck.setPosture(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <KeysMasthead c={c} deck={deck} />

      {deck.notice && (
        <div className={`flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs ${NOTICE_TONE[deck.notice.tone] || NOTICE_TONE.warn}`}>
          <span className="material-symbols-outlined text-[14px] mt-0.5">info</span>
          <span className="flex-1 whitespace-pre-line">{deck.notice.message}</span>
          <button
            onClick={() => deck.setNotice(null)}
            className="motion-control opacity-70 hover:opacity-100"
            title={translate("Dismiss")}
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      <Card>
        <KeyToolbar deck={deck} />

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
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

      <BulkActionBar deck={deck} />

      {deck.detailKey && (
        <KeyDetailDrawer key={deck.detailKey.id} k={deck.detailKey} deck={deck} />
      )}

      <KeyImportModal deck={deck} />
    </div>
  );
}
