/**
 * logQuery.js — the READ side of the ledger, in the harbor's own house.
 *
 * WHY A SEPARATE FILE FROM logStore.js: logStore.js is the WORKER's door. It
 * is loaded BY PATH into a spawned thread where the `@/` alias does not
 * resolve, and every statement in it is a write. The read side needs three
 * things the worker's store does not offer — a keyset page that learns
 * `hasMore` without a second COUNT, an ASC-ordered replay for the SSE tail,
 * and an INCREMENTAL cursor so `/export` streams instead of buffering.
 *
 * ═══ THE BINDING MANDATE (identical to logStore.js's) ═════════════════════
 *   `msg` carries upstream-controlled error text and is a live injection
 *   primitive if concatenated. Every value reaches SQLite as a BOUND
 *   PARAMETER; the only interpolated text is the fixed column list declared by
 *   logSelector.js. `log-events-api` pins an injection literal landing intact
 *   as DATA.
 *
 * ═══ WHY THE RAW ADAPTER IS REACHABLE FROM HERE ═════════════════════════
 *   `db-contract-census.test.js` allows raw-adapter access inside
 *   `src/lib/db/repos/sqlite/` — that IS the harbor. A repo facade bound
 *   through bind.js is required for the POSTURE-aware tables; logEvents is
 *   primary-only by design (§10's mirror divergence), so it has no mysql twin
 *   and no mirror decorator to bind.
 */
import { getLogStore } from "./logStore.js";
import { LOG_EVENT_COLUMNS, buildLogWhere, toWireRow } from "@/lib/logSelector.js";

/**
 * Open the harbor and make sure the ledger exists.
 *
 * `getLogStore()` is called for its `ensureTable()` and nothing else: on a
 * cold process the additive sync has not necessarily created logEvents yet,
 * and a SELECT against a missing table is a 500, never an honest empty page.
 * It resolves the SAME adapter singleton the query then uses — one handle, one
 * checkpoint owner, never two.
 */
async function openHarbor() {
  await getLogStore();
  // Reached RELATIVELY, never via `@/`: this file lives two levels below
  // src/lib/db/, and a static `@/lib/db/driver.js` here would be a second
  // import edge the worker's path-loaded sibling graph must not inherit.
  const { getAdapter } = await import("../../driver.js");
  return getAdapter();
}

/**
 * One page, newest first, keyset on `id`.
 *
 * `limit + 1` rows are selected and the surplus is dropped, so `hasMore` is a
 * FACT — a row existed past the page — rather than a COUNT() guess that costs
 * a second scan on a 200k ledger. The cursor the caller hands back is the last
 * id of the page it received; there is no OFFSET anywhere in this file.
 *
 * @param {object} selector parsed selector (carries `limit`)
 * @param {string|null} q
 * @param {{qHonoured?: boolean}} [opts]
 * @returns {Promise<{rows: object[], nextCursor: number|null, hasMore: boolean}>}
 *
 * NOTE ON THE `${clauseText}` INTERPOLATIONS BELOW, since a reader (or a grep
 * guard shaped like the logshipper one) will meet them and ask.
 *
 * `clauseText` is SQL TEXT assembled by `buildLogWhere` from FIXED column
 * names and FIXED keywords only (`stream = ?`, `msg LIKE ? ESCAPE '\'`).
 * Every caller-supplied value travels in `params` as a bound placeholder.
 * The split is named rather than left implicit: `clauseText` can only ever
 * carry structure, `params` only ever carries data — so the one expression a
 * future reader might be tempted to interpolate a value into is named for
 * what it actually is.
 */
export async function queryLogPage(selector, q, opts = {}) {
  const { sql: clauseText, params } = buildLogWhere(selector, q, opts);
  const db = await openHarbor();
  const rows = db.all(
    `SELECT ${LOG_EVENT_COLUMNS} FROM logEvents ${clauseText} ORDER BY id DESC LIMIT ?`,
    [...params, selector.limit + 1]
  );
  const hasMore = rows.length > selector.limit;
  const page = (hasMore ? rows.slice(0, selector.limit) : rows).map(toWireRow);
  return {
    rows: page,
    nextCursor: hasMore && page.length ? page[page.length - 1].id : null,
    hasMore,
  };
}

/**
 * The LATEST `limit` rows, ASCENDING — what the SSE tail replays before it
 * subscribes to live lines.
 *
 * Ascending is the only order a tail can render: newest-first would force the
 * client to prepend into an ever-growing buffer, which is how a live tail ends
 * up rendering backwards under load.
 */
export async function queryLogTail(limit, selector = {}, q = null, opts = {}) {
  const { sql: clauseText, params } = buildLogWhere({ ...selector, before: null }, q, opts);
  const db = await openHarbor();
  const rows = db.all(
    `SELECT ${LOG_EVENT_COLUMNS} FROM logEvents ${clauseText} ORDER BY id DESC LIMIT ?`,
    [...params, limit]
  );
  return rows.reverse().map(toWireRow);
}

/** Rows matching a selector — the census `/stats` reports. No `q`. */
export async function countLogEvents(selector, opts = {}) {
  const { sql: clauseText, params } = buildLogWhere(selector, null, opts);
  const db = await openHarbor();
  const row = db.get(`SELECT COUNT(*) AS n FROM logEvents ${clauseText}`, params);
  return Number(row?.n ?? 0);
}

/**
 * The export cursor — an ASYNC GENERATOR over keyset windows.
 *
 * Returning the whole cap as an array would buffer the entire file before the
 * first byte reaches the socket: precisely the O(file) pause §6 refuses. Each
 * window here is a bounded `id > cursor` page, so peak memory is ONE PAGE no
 * matter how large `cap` is.
 *
 * @param {{pageSize?: number, cap?: number, selector?: object, q?: string|null,
 *          opts?: {qHonoured?: boolean}}} [args]
 * @returns {AsyncGenerator<object>} wire rows, ASCENDING.
 */
export async function* iterateLogRows({ pageSize = 1_000, cap = Infinity, selector = {}, q = null, opts = {} } = {}) {
  // The caller's `before` cursor is DROPPED: an export reads the whole range
  // from the start, and honouring a half-open page cursor here would silently
  // ship a truncated file that looks complete.
  const base = { ...selector, limit: pageSize, before: null };
  const db = await openHarbor();
  let cursor = 0;
  let produced = 0;
  while (produced < cap) {
    const take = Math.min(pageSize, cap - produced);
    const { sql: clauseText, params } = buildLogWhere(base, q, opts);
    // The window's own `id > cursor` is appended AFTER the caller's selector,
    // exactly like `q` — the fixed clause, one bound integer.
    const windowSql = clauseText ? `${clauseText} AND id > ?` : "WHERE id > ?";
    const window = db.all(
      `SELECT ${LOG_EVENT_COLUMNS} FROM logEvents ${windowSql} ORDER BY id ASC LIMIT ?`,
      [...params, cursor, take]
    );
    if (!window.length) return;
    for (const row of window) {
      yield toWireRow(row);
      produced += 1;
      if (produced >= cap) return;
    }
    cursor = Number(window[window.length - 1].id);
    if (window.length < take) return; // the ledger is exhausted
  }
}
