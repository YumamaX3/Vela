/**
 * redact.js — the harbor's confidentiality door (sealed plan r3 §5).
 *
 * Two layers, IN THIS ORDER, and the order is the law:
 *
 *   1. PATH redaction — a STATIC, CLOSED key allowlist. A value whose key is
 *      one of `SENSITIVE_KEYS` is replaced whole, at any depth of `meta`,
 *      whatever its type.
 *   2. SHAPE scrub — a compiled, static list of secret shapes swept over the
 *      serialized text of BOTH `msg` and `meta`. This is the layer the path
 *      allowlist structurally cannot do: a secret INTERPOLATED into a message
 *      string ("caller presented vela-v1-… rejected") has no key to allowlist.
 *      The most likely secret in a gateway log is the caller's own presented
 *      key on an auth-failure or header-echo line, so this layer is load-bearing.
 *
 * ═══ WHY STATIC PATHS AND NO WILDCARDS ═══
 * fast-redact's own measured cost law: fully static paths cost ~1–2% of the
 * serialization, intermediate WILDCARDS cost 25–50% and are the fragile form.
 * User-defined paths are forbidden outright (pino warns about them for good
 * reason). So every entry below is a literal key name in a frozen set and every
 * shape is a module-level constant compiled ONCE at module init — nothing is
 * built per line, and nothing is built from input. A `log-redact` suite case
 * pins the law mechanically: no member of the set may contain `*` or `?`.
 *
 * The key set is checked at EVERY depth rather than as dotted `a.b.c` paths
 * because `meta` is an arbitrary operator-shaped object of unbounded depth; the
 * set itself stays static and closed, which is the part the cost law is about.
 *
 * ═══ FIRST-PARTY KEYS ARE SOURCED, NEVER RE-TYPED (r3, wallkeeper HIGH) ═══
 * Vela's own key is `vela-v1-<32 hex>-<8 hex>`. That shape is NOT written here
 * as a literal. The module imports `parseVelaKeyShape` — the repo's OWN format
 * parser — and uses it as the ORACLE: candidate runs are harvested by a
 * generic token regex that contains no first-party knowledge, and each
 * candidate is admitted only when the real parser accepts it. Ground truth is
 * the module that mints the keys, so a format change cannot leave the redactor
 * scrubbing a shape nothing produces. `parseVelaKeyShape` (not `parseVelaKey`)
 * is the right oracle for a second reason: it validates the shape WITHOUT the
 * crc, so a key minted under a rotated `API_KEY_SECRET` is still caught.
 *
 * `KEY_VERSION` is imported and used as the cheap pre-filter gate, so even the
 * gate follows the constant. `KEY_PREFIX` is module-local in apiKey.js and NOT
 * exported — which is exactly why the parser, not a prefix literal, is the
 * oracle here. Nothing in this file needs the prefix because it never has to
 * FIND the key by name; the parser confirms it.
 *
 * `vela-internal-<purpose>` and `x-vela-cli-token` are re-typed strings here:
 * they are markers, not formats, and no exported constant carries them today
 * (the marker is spelled at three repo call sites in `apiKeysRepo` /
 * `mirrorApplyRepo`, the header name in `dashboardGuard.js` and two routes).
 * If either becomes an exported constant, this file must import it.
 *
 * ═══ FAIL CLOSED (the law of this module) ═══
 * Uncertain → redact. Every matcher call sits inside a try/catch; a throw
 * replaces the WHOLE FIELD with `[REDACTED]` rather than letting a partially
 * scrubbed string through. A thrown shape is a bug in a shape, and the
 * operator must never be the one to discover it from a leaked credential. The
 * same law covers a cyclic `meta` object: the cycle is broken with a redaction,
 * not a stack overflow.
 *
 * `redactEntry` NEVER throws — the write door calls it synchronously on every
 * line, and a redactor that can take down the gateway is worse than no
 * redactor. The worst case is a fully redacted line.
 *
 * Failures are COUNTED in a module-level flag (`redactionFailureState()`), not
 * written to a sink: this module has no I/O, no DB and no console calls, so the
 * door can call it synchronously and the surface can surface the count in
 * `/api/logs/stats`. One-time notice semantics live in the caller.
 *
 * Purity: `redactEntry` returns a NEW object, adds no fields beyond `{msg,
 * meta}`, and never mutates its input. Callers get exactly the shape they
 * passed in, minus secrets.
 */

// The key shape's owner: `KEY_VERSION` is the arm's alignment anchor and
// `parseVelaKeyShape` is its ORACLE — the only thing that decides whether a
// candidate is a real key. Nothing in this file re-types the shape.
import { KEY_VERSION, parseVelaKeyShape } from "@/shared/utils/apiKey.js";

/** The one marker every redaction writes. */
export const REDACTED = "[REDACTED]";

/**
 * The static path allowlist — key NAMES, matched case-insensitively at every
 * depth of `meta`. Closed set, no wildcards, no user input.
 *
 * Anything a caller would use to authenticate is here; nothing an operator
 * diagnoses with is. That is the line: `token` is in because every upstream in
 * this harbor authenticates with one, and `keyId` is NOT in because it is the
 * non-secret attribution id apiKey.js's own header calls out as safe to print.
 */
export const SENSITIVE_KEYS = Object.freeze([
  // Credentials carried in headers.
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "api_key",
  "x-goog-api-key",
  "x-vela-cli-token",
  "x-9r-password",
  // Bearer-token fields, in every casing the harbor actually writes.
  "auth",
  "bearer",
  "token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "idtoken",
  "session_token",
  "sessiontoken",
  "api_secret",
  "apisecret",
  "client_secret",
  "clientsecret",
  // Anything password-shaped.
  "password",
  "passphrase",
  "secret",
  "private_key",
  "privatekey",
  // Cookie carriers in the plural spellings the harbor and its upstreams use.
  "cookies",
  "cookie_jar",
  "set-cookies",
]);

/** Lower-cased lookup, built once. A second copy of the list is a drift source. */
const SENSITIVE_LOOKUP = new Set(SENSITIVE_KEYS);

// ─── The shape list ─────────────────────────────────────────────────────────
// Each entry is frozen; the ARRAY is not, so a suite can plant a hostile
// matcher and drive the fail-closed path through the real code (see
// log-redact.test.js). Production never mutates it.

/**
 * First-party Vela key, matched BY THE REAL PARSER.
 *
 * `CANDIDATE_RE` is deliberately ignorant: it harvests token-shaped runs and
 * knows nothing about Vela's format. `parseVelaKeyShape` is the only thing that
 * decides, so the shape cannot drift from the mint.
 */
const CANDIDATE_RE = /[A-Za-z0-9_][A-Za-z0-9_-]{3,}/g;
/**
 * 32 hex keyId + '-' + 8 hex crc = 41 is the shortest possible key BODY; the
 * prefix and version only add to it. A derived LOWER BOUND, not a restated
 * shape — the parser still decides every candidate.
 */
const FIRST_PARTY_MIN_CHARS = 41;

/**
 * The token a real key is ALIGNED ON: the version's leading dash plus the
 * version itself. Built from the imported constant, so it follows the mint
 * rather than being typed here.
 *
 * ═══ WHY THIS SUBSTITUTES FOR THE UNEXPORTED PREFIX ═══
 * Locating a key inside an undelimited run needs an anchor, and the natural one
 * is the prefix — which is module-local in apiKey.js. The plan's law is that the
 * KEY SHAPE is never re-typed as a literal, and this honours it exactly: the
 * anchor is a PLACEMENT hint only. It decides where the parser is handed a
 * candidate; it never decides whether the candidate IS a key. A span that
 * merely contains the anchor is still rejected unless `parseVelaKeyShape` itself
 * accepts it — so a wrong anchor could at worst cost a missed match, never
 * invent one. Writing the prefix literal instead WOULD be the shape restated,
 * which is exactly what the wallkeeper's finding was about.
 *
 * The alternative — reading apiKey.js's own source for `KEY_PREFIX` — was
 * measured and REFUSED: `import.meta.resolve` is not transformed by the vitest
 * pipeline, so the runtime read died on the `@/` alias in the very suite meant
 * to prove this arm. A file read at import is also a packaging hazard under
 * standalone output, bought with nothing the parser does not already give.
 */
const VERSION_ANCHOR = `-${KEY_VERSION}`;

/**
 * The bound on the backward scan below. It bounds HOW FAR the search walks, and
 * is never a claim about the prefix's length: the parser rejects every wrong
 * start outright, so a window that is too small can only MISS a key — failing
 * closed toward redaction — never invent one. Sixteen is generous for any
 * prefix that could plausibly ship.
 */
const PREFIX_WINDOW = 16;

/**
 * Locate the first key-shaped span inside a run that the REAL parser accepts.
 * Returns `{ offset, length }` or null.
 *
 * A key is normally delimited, so the run starts exactly at the key and the
 * walk begins at offset zero. The backward scan covers the case where it is not
 * — a key written against a label with no delimiter, or a run of filler that
 * swallowed the key whole — without needing the prefix's length, which is not
 * exported and must not be typed here.
 */
function locateKeyIn(run) {
  let from = 0;
  for (;;) {
    const at = run.indexOf(VERSION_ANCHOR, from);
    if (at === -1) return null;
    // The version anchor sits INSIDE the key, so walk back over the prefix. The
    // parser is the oracle at every candidate start: it is what rejects a wrong
    // one and what accepts the right one.
    for (let back = 0; back <= PREFIX_WINDOW; back += 1) {
      const start = at - back;
      if (start < 0) break;
      const candidate = run.slice(start);
      if (candidate.length < FIRST_PARTY_MIN_CHARS) break;
      if (parseVelaKeyShape(candidate)) return { offset: start, length: run.length - start };
    }
    from = at + 1;
  }
}

/**
 * Replace every occurrence the parser recognizes as a first-party key.
 *
 * The anchor gate is the cheap reject: a string that does not contain the
 * anchor cannot hold a key, and the check costs one `indexOf`.
 */
function scrubFirstPartyKey(text) {
  if (!text.includes(VERSION_ANCHOR)) return text;

  let out = "";
  let cursor = 0;
  CANDIDATE_RE.lastIndex = 0;
  let match = CANDIDATE_RE.exec(text);
  while (match !== null) {
    const hit = locateKeyIn(match[0]);
    if (hit) {
      const start = match.index + hit.offset;
      out += text.slice(cursor, start) + REDACTED;
      cursor = start + hit.length;
      // Resume past the key so its own segments are never re-examined.
      CANDIDATE_RE.lastIndex = cursor;
    }
    match = CANDIDATE_RE.exec(text);
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

/**
 * The compiled shape list, in sweep order. Every entry is `{ name, repl, re }`
 * for a RegExp shape, or `{ name, detect }` for the parser-backed one.
 */
export const SECRET_SHAPES = [
  {
    name: "bearer",
    repl: REDACTED,
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  },
  {
    name: "openai-style-key",
    repl: REDACTED,
    // `sk-` keys: the legacy OpenAI shape plus the current `sk-proj-…`.
    re: /\bsk-[A-Za-z0-9_-]{8,}/g,
  },
  {
    name: "aws-access-key-id",
    repl: REDACTED,
    re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  },
  {
    // The AWS SECRET access key has no prefix, so it is only reachable through
    // the assignment that carries it. The key name survives; the value does not.
    name: "aws-secret-access-key",
    repl: "$1=[REDACTED]",
    re: /(aws_secret_access_key|awsSecretAccessKey)["']?\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/gi,
  },
  {
    name: "slack-token",
    repl: REDACTED,
    re: /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  },
  {
    name: "slack-webhook",
    repl: REDACTED,
    re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  },
  {
    name: "jwt",
    repl: REDACTED,
    re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  },
  {
    // Multi-line PEM. Swept AFTER the single-line shapes so a body line is
    // never half-matched on its own before the block arm sees it whole.
    name: "private-key-block",
    repl: REDACTED,
    re: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/g,
  },
  {
    name: "api-key-header-value",
    repl: "$1=[REDACTED]",
    re: /(x-api-key|x-goog-api-key|api[_-]?key)["']?\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{12,}/gi,
  },
  {
    // Parser-backed, NOT a literal. See the header note above.
    name: "first-party-vela-key",
    detect: scrubFirstPartyKey,
  },
  {
    // Marker for an internal-purpose key row (apiKeysRepo's keyPrefix).
    name: "vela-internal-key",
    repl: REDACTED,
    re: /\bvela-internal-[A-Za-z0-9_-]+/g,
  },
  {
    name: "vela-cli-token",
    repl: "$1=[REDACTED]",
    re: /(x-vela-cli-token)["']?\s*[=:]\s*["']?[A-Za-z0-9_-]{8,}/gi,
  },
].map(Object.freeze);

// ─── The fail-closed flag ───────────────────────────────────────────────────

let failureCount = 0;
let firstFailureAt = null;

/**
 * Record a redaction that had to fail closed. Counted, never logged: this
 * module performs no I/O and writes to no sink. The door may surface the count.
 */
function recordFailure() {
  failureCount += 1;
  if (firstFailureAt === null) firstFailureAt = Date.now();
}

/** @returns {{count:number, firstAt:number|null}} the fail-closed tally. */
export function redactionFailureState() {
  return { count: failureCount, firstAt: firstFailureAt };
}

/**
 * Sweep one string through the shape list. Pure: returns a new string, never
 * throws, and on any matcher fault replaces the WHOLE string with `[REDACTED]`.
 *
 * @param {unknown} text
 * @param {ReadonlyArray<object>} [shapes] injection seam for the suite only
 */
export function redactText(text, shapes = SECRET_SHAPES) {
  if (typeof text !== "string" || text.length === 0) return text;
  try {
    let out = text;
    for (const shape of shapes) {
      if (typeof shape.detect === "function") {
        out = shape.detect(out);
      } else {
        out = out.replace(shape.re, shape.repl);
      }
      if (out === REDACTED) break;
    }
    return out;
  } catch {
    recordFailure();
    return REDACTED;
  }
}

// ─── meta ───────────────────────────────────────────────────────────────────

/** True for the object kinds whose own enumerable keys are worth walking. */
function isWalkable(value) {
  return typeof value === "object" && value !== null;
}

function redactValue(value, seen) {
  if (typeof value === "string") return redactText(value);
  if (!isWalkable(value)) return value; // numbers, booleans, null — typed fields

  // A cycle would recurse forever; fail closed on the repeat.
  if (seen.has(value)) {
    recordFailure();
    return REDACTED;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      // An array carries no key to allowlist, so the SHAPE layer is the only
      // layer that can see inside it — and the last-mile arm is a KEY-NAMED
      // arm, which would ride straight past a bare `["a=1","b=2"]`. Sweep the
      // ELEMENTS. Yes: a cookie jar under `set-cookie` is exactly the case this
      // exists for, and a last-mile scrub that cannot see one does not work.
      return value.map((item) => redactValue(item, seen));
    }
    const keys = Object.keys(value);
    // A Date/Map/Error carries no own enumerable keys; JSON.stringify renders
    // it the same way it did before this module existed, so leave it alone.
    if (keys.length === 0) return value;
    const out = {};
    for (const key of keys) {
      // Layer 1: the static path allowlist replaces the value WHOLE, whatever
      // its type — and the value is never even READ, so a throwing getter under
      // an allowlisted key cannot run at all.
      if (SENSITIVE_LOOKUP.has(key.toLowerCase())) {
        out[key] = REDACTED;
        continue;
      }
      let child;
      try {
        child = value[key];
      } catch {
        // One unreadable field is ONE uncertain field: redact that field and
        // carry on, so a single hostile getter cannot blind the whole row and
        // destroy the typed fields the operator reads the line for.
        recordFailure();
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactValue(child, seen);
    }
    return out;
  } catch {
    recordFailure();
    return REDACTED;
  } finally {
    seen.delete(value);
  }
}

/**
 * Redact one log entry. THE public entry point of this module.
 *
 * Order is §5's: path redaction first, shape scrub second. Returns a NEW
 * `{ msg, meta }` and nothing else — no field is added, renamed or dropped, and
 * the input is never mutated. A non-object entry is treated as absent.
 *
 * @param {{msg?: unknown, meta?: unknown}} entry
 * @returns {{msg: unknown, meta: unknown}}
 */
export function redactEntry(entry) {
  try {
    const source = isWalkable(entry) && !Array.isArray(entry) ? entry : {};
    return { msg: redactValue(source.msg, new WeakSet()), meta: redactValue(source.meta, new WeakSet()) };
  } catch {
    recordFailure();
    return { msg: REDACTED, meta: REDACTED };
  }
}