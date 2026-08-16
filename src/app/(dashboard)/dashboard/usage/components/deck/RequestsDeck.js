// Usage Observatory W2-E — the Requests deck, "What happened?"
// The server-paginated keyset ledger: sortable (URL-riding sort+order),
// keyboard-first (↑/↓/Enter), drawer detail with the honesty clause, the
// 'N new requests' pill that never reflows a read, and the deck-local search
// facet. The deep request-details tab (the old W2-B seed) is retired by this
// composition — its metadata lives in the drawer; its conversation payloads
// stay redacted by covenant (phase13).
"use client";

import { t } from "../../lib/t";
import LedgerTable from "./requests/LedgerTable";

export default function RequestsDeck({ compass }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-base font-semibold text-text">{t("Requests")}</h2>
        <span className="text-xs text-text-muted">{t("What happened?")}</span>
      </div>
      <LedgerTable compass={compass} />
    </div>
  );
}
