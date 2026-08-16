// Usage Observatory W2-E — the Requests deck, "What happened?"
// W2-B seeds it with the pre-existing RequestDetailsTab; W2-E grafts the
// server-paginated keyset ledger (sortable, drawer w/ redaction, keyboard
// nav, 'N new' pill, CSV honoring filters).
"use client";

import RequestDetailsTab from "../RequestDetailsTab";

export default function RequestsDeck() {
  return <RequestDetailsTab />;
}
