/**
 * logSelector.js — §6's selector: parse, validate, and (bound) narrow.
 *
 * ── WHY THIS IS A FILE AND NOT INLINE IN THE ROUTE ─────────────────────────
 *   Four doors read the ledger through it (`/events`, `/events/stream`'s
 *   replay, `/export`), and §11 asks for mutation targets that are a SINGLE
 *   named law. The parse/validate/escape behaviour lives here so a test can
 *   drive it without a Request, and so a change to the `q` law cannot land in
 *   one door and miss another.
 *
 * ── THE BINDING MANDATE (r3, wallkeeper HIGH) ──────────────────────────────
 *   `msg` carries upstream-controlled text. Every value here reaches SQLite as
 *   a BOUND PARAMETER; the only strings ever interpolated into SQL are the
 *   fixed column names this module itself declares. `tests/unit/log-events-api`
 *   pins both — and the logshipper SQL-concat guard (which greps
 *   `src/lib/logshipper/`) is the standing ratchet for the transport half.
 *
 * ── THE 400 LAWS (r3, the silent-empty class) ──────────────────────────────
 *   A NaN `minLvl` reaches SQLite as NULL and the predicate `lvl >= NULL` is
 *   never true, so the door answers 200 + zero rows: the exact failure a
 *   3 a.m. operator cannot tell from "the gateway was quiet". Every numeric
 *   selector is therefore parsed with `Number()` + `Number.isFinite` + an
 *   integer check, and a failure is a 400 with a NAMED field — never a filter
 *   that silently discards rows.
 */
import { LOG_LEVELS } from "@/lib/logshipper/index.js";

/** The five declared streams of §1. Anything else is a 400, not a cast. */
export const VALID_STREAMS = Object.freeze(["console", "container", "request"]);

/** §1's numeric level enum, ascending. `minLvl` is `>=` against these. */
export const VALID_LEVEL_NUMBERS = Object.freeze(Object.values(LOG_LEVELS).sort((a, b) => a - b));

/**
 * The two-tier law: `q` is honoured ONLY when the selector already narrowed
 * (stream · provider · reqId · upstreamId · tag · lvl-range · time window).
 *
 * WHY: an unnarrowed `LIKE '%needle%'` over 200k rows is the widest scan the
 * table can be asked for, and §1's conditioned-search claim is explicitly a
 * NARROWED one. A caller who wants free text names the stream first.
 */
export const NARROWING_KEYS = Object.freeze(["stream", "provider", "reqId", "upstreamId", "tag", "minLvl", "since", "until"]);

/** The secret prefixes §6 refuses a free-text query over. */
export const SECRET_QUERY_PREFIXES = Object.freeze(["vela-v1-", "sk-", "Bearer "]);

/** The row cap on ONE page. §1's keyset law: a cursor, never an OFFSET. */
export const PAGE_LIMIT_DEFAULT = 200;
export const PAGE_LIMIT_MAX = 1_000;

/** One raised selector problem. `.status` is always 400 — §6 has no other. */
export class SelectorError extends Error {
  constructor(field, message) {
    super(message || `Invalid selector: ${field}`);
    this.name = "SelectorError";
    this.field = field;
    this.status = 400;
  }
}

const MAX_SELECTOR_LENGTH = 512;

/**
 * A text selector: exact-match fields are length-capped so a caller cannot
 * hand the index a megabyte-long probe, and an empty value is simply absent
 * (an empty `?provider=` narrows nothing — pretending otherwise would be a
 * filter that reads as applied and is not).
 */
function readText(params, name) {
  const raw = params.get(name);
  if (raw === null) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.length > MAX_SELECTOR_LENGTH) throw new SelectorError(name, `${name} is too long`);
  return value;
}

/**
 * An INTEGER selector: `Number()` → finite → integer. Each stage is named
 * because each stage is a different operator mistake, and the 400 says which.
 */
function readInt(params, name, { min = null, max = null } = {}) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new SelectorError(name, `${name} must be a finite number`);
  if (!Number.isInteger(value)) throw new SelectorError(name, `${name} must be an integer`);
  if (min !== null && value < min) throw new SelectorError(name, `${name} must be >= ${min}`);
  if (max !== null && value > max) throw new SelectorError(name, `${name} must be <= ${max}`);
  return value;
}

/**
 * Escape the LIKE metacharacters with an explicit ESCAPE clause.
 *
 * An unescaped `%` from a caller forces the widest possible scan while the
 * operator believes they asked for a literal — the r3 finding, exactly.
 * `\` must be escaped FIRST or it would double-escape the other two.
 */
export function escapeLike(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** The ESCAPE clause every LIKE built by this module carries. */
const LIKE_ESCAPE_CLAUSE = "ESCAPE '\\'";

/**
 * Parse §6's selector from a URLSearchParams.
 *
 * @param {URLSearchParams} params
 * @returns {{selector: object, narrowed: boolean, q: string|null}}
 * @throws {SelectorError} on any invalid field — the route turns it into 400.
 */
export function parseLogSelector(params) {
  const stream = readText(params, "stream");
  if (stream !== null && !VALID_STREAMS.includes(stream)) {
    throw new SelectorError("stream", `stream must be one of ${VALID_STREAMS.join(", ")}`);
  }

  const minLvl = readInt(params, "minLvl", { min: 0, max: 50 });
  if (minLvl !== null && !VALID_LEVEL_NUMBERS.includes(minLvl)) {
    throw new SelectorError("minLvl", `minLvl must be one of ${VALID_LEVEL_NUMBERS.join(", ")}`);
  }

  const selector = {
    minLvl,
    stream,
    provider: readText(params, "provider"),
    tag: readText(params, "tag"),
    reqId: readText(params, "reqId"),
    upstreamId: readText(params, "upstreamId"),
    since: readInt(params, "since", { min: 0 }),
    until: readInt(params, "until", { min: 0 }),
    // Keyset: `id < before`. NEVER OFFSET — §6's keyset law, and the only
    // reason a 200k-row ledger pages in constant time.
    before: readInt(params, "before", { min: 1 }),
  };
  if (selector.since !== null && selector.until !== null && selector.since > selector.until) {
    throw new SelectorError("since", "since must be <= until");
  }

  // The page size is a validated selector too: `limit=1.5` is a 400, not a
  // silently floored row count that makes the client's cursor arithmetic lie.
  const rawLimit = readInt(params, "limit", { min: 1, max: PAGE_LIMIT_MAX });
  const limit = rawLimit ?? PAGE_LIMIT_DEFAULT;

  const narrowed = NARROWING_KEYS.some((key) => selector[key] !== null && selector[key] !== undefined);

  const rawQ = params.get("q");
  let q = null;
  if (rawQ !== null && rawQ.trim() !== "") {
    q = rawQ.trim();
    if (q.length > MAX_SELECTOR_LENGTH) throw new SelectorError("q", "q is too long");
    // §6: a free-text oracle over best-effort-redacted rows is a
    // secret-search oracle. The door must not help enumerate what leaked.
    const lowered = q.toLowerCase();
    for (const prefix of SECRET_QUERY_PREFIXES) {
      if (lowered.includes(prefix.toLowerCase())) {
        throw new SelectorError("q", "q must not contain credential-shaped substrings");
      }
    }
  }

  return { selector: { ...selector, limit }, narrowed, q };
}

/**
 * Build the WHERE fragment for a parsed selector + `q`.
 *
 * §6's ORDER LAW: the structured selector narrows FIRST; `q` is appended
 * AFTER it, so the index-eligible predicates ride the same statement as the
 * LIKE and the scan stays conditioned. Swapping these two clauses returns a
 * DIFFERENT row set, which is why `log-events-api` pins the order with a
 * mutation (`wrong rows survive`).
 *
 * Every value is BOUND. The only interpolated text is the fixed column name
 * and the fixed `ESCAPE '\\'` clause.
 *
 * @param {object} selector  the parsed selector (carries `limit`)
 * @param {string|null} q    the raw free-text term, or null
 * @param {{qHonoured?: boolean}} [opts]
 * @returns {{sql: string, params: any[]}}
 */
export function buildLogWhere(selector, q, { qHonoured = false } = {}) {
  const clauses = [];
  const params = [];

  if (selector.minLvl !== null && selector.minLvl !== undefined) {
    clauses.push("lvl >= ?");
    params.push(selector.minLvl);
  }
  if (selector.stream) {
    clauses.push("stream = ?");
    params.push(selector.stream);
  }
  if (selector.provider) {
    clauses.push("provider = ?");
    params.push(selector.provider);
  }
  if (selector.tag) {
    clauses.push("tag = ?");
    params.push(selector.tag);
  }
  if (selector.reqId) {
    clauses.push("reqId = ?");
    params.push(selector.reqId);
  }
  if (selector.upstreamId) {
    clauses.push("upstreamId = ?");
    params.push(selector.upstreamId);
  }
  if (selector.since !== null && selector.since !== undefined) {
    clauses.push("ts >= ?");
    params.push(selector.since);
  }
  if (selector.until !== null && selector.until !== undefined) {
    clauses.push("ts <= ?");
    params.push(selector.until);
  }
  if (selector.before !== null && selector.before !== undefined) {
    clauses.push("id < ?");
    params.push(selector.before);
  }

  // AFTER the selector, never before it.
  if (q && qHonoured) {
    clauses.push(`msg LIKE ? ${LIKE_ESCAPE_CLAUSE}`);
    params.push(`%${escapeLike(q)}%`);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/** The fixed projection every read door shares — one shape, three doors. */
export const LOG_EVENT_COLUMNS =
  "id, ts, lvl, stream, reqId, upstreamId, provider, tag, msg, meta, truncMsg, truncMeta";

/** Shape one DB row into the wire row (numbers as numbers, flags as booleans). */
export function toWireRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    ts: Number(row.ts),
    lvl: Number(row.lvl),
    stream: row.stream,
    reqId: row.reqId ?? null,
    upstreamId: row.upstreamId ?? null,
    provider: row.provider ?? null,
    tag: row.tag ?? null,
    msg: row.msg ?? "",
    meta: row.meta ?? null,
    truncMsg: Number(row.truncMsg) === 1 || row.truncMsg === true,
    truncMeta: Number(row.truncMeta) === 1 || row.truncMeta === true,
  };
}
