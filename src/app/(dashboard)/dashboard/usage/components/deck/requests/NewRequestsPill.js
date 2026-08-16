// Usage Observatory W2-E — the 'N new requests' pill (sealed plan Deck-3).
// Rendered on the SSE heartbeat: when fresh rows exist deeper than the top of
// the screen, the pill offers to refresh — and the table NEVER reflows under
// the user's cursor (no silent re-sort while reading). Applied by resetting
// the cursor to the freshest window.
"use client";

import { t } from "../../../lib/t";

export default function NewRequestsPill({ count, onApply }) {
  if (!count || count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onApply}
      className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
    >
      <span className="material-symbols-outlined text-[14px]">north</span>
      {t("{n} new requests", { n: count })}
    </button>
  );
}
