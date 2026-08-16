// Usage Observatory W2-E — client-safe SORTABLE_COLUMNS mirror.
//
// The identifier covenant (src/lib/db/usageNames.js) holds the server-side
// SORTABLE_COLUMNS map that the ledger route validates `sort` against. Client
// components can NOT import usageNames — it drags the DB layer into the
// browser bundle. This mirror is the client-side copy the ledger UI builds
// its sort controls from. The engine still validates every request against
// its own frozen map; the mirror only keeps the UI from offering a column
// the engine would refuse (400 INVALID_FILTER_PARAM). The engine additionally
// funds the deck's `q` search facet (census LIKE over model/provider/endpoint,
// W1-C) — no client mirror needed; the census is server-side law.
//
// DRIFT GUARD: tests/unit/usage-ledger-w2e.test.js asserts this map's keys
// are identical to the engine's SORTABLE_COLUMNS. If the engine gains a
// sortable column, add it here AND the test keeps holding.
export const LEDGER_SORTABLE_COLUMNS = Object.freeze([
  "timestamp",
  "provider",
  "model",
  "keyId",
  "endpoint",
  "cost",
  "status",
  "latencyMs",
  "ttftMs",
  "promptTokens",
  "completionTokens",
]);
