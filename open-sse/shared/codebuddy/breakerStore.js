// A circuit breaker that survives a restart — and cannot be made to survive forever.
//
// Vela's CodeBuddy breaker is honest but forgetful: it lives in a Map, so every
// restart forgets which accounts just failed and hands them traffic again. The
// reference gateway persists its table and, more importantly, records the four laws
// that make a persisted breaker safe. All four are carried here.
//
//   1. A RESTORED DEADLINE CAN NEVER SIT FURTHER OUT THAN ITS CEILING. A stale or
//      hand-edited file must not park an account permanently, so every deadline is
//      clamped at read time, not trusted. Anything already expired, non-finite, or
//      beyond the ceiling is discarded rather than repaired into something live.
//
//   2. THE READER ACCEPTS ONLY A WHOLLY VALID SNAPSHOT. One malformed row discards
//      the document — a file the reader half-understands is worse than no file,
//      because it would silently keep some cooldowns and drop others.
//
//   3. STORAGE FAILURE DEGRADES TO MEMORY, NEVER TO LOCKOUT. A breaker that cannot
//      write must still admit traffic; an unusable store costs one repeated attempt,
//      not an account disabled forever.
//
//   4. THE WRITE IS BOUNDED. Past the byte cap, rows nearest expiry are shed rather
//      than growing the file without limit — and a caller whose own row was shed is
//      TOLD so, because a cooldown that did not land is not a cooldown.
//
// Deliberately absent: any notion of a per-model table. Vela's breaker is per
// credential, which is the grain its executors actually key on.

/** Schema version of the on-disk document. */
export const BREAKER_STORE_VERSION = 1;

/** Bounds — the table is a small advisory cache, not a ledger. */
export const BREAKER_MAX_ACCOUNTS = 256;
export const BREAKER_MAX_BYTES = 256 * 1024;

/** Ceilings, in milliseconds. A credential breaker is short-lived by nature. */
export const BREAKER_AUTH_CEILING_MS = 60 * 60 * 1000; // 1h
export const BREAKER_MAX_REASON_CHARS = 256;

/** Accept only a finite number. Booleans are not numbers; huge ints must not throw. */
function finiteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/** Accept only printable text, bounded. Never throws on hostile input. */
function safeText(value, limit = BREAKER_MAX_REASON_CHARS) {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) out += ch;
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/**
 * A deadline is kept only when it is finite, still in the future, and inside the
 * ceiling. Everything else becomes null — the row is discarded, never softened.
 */
function validDeadline(value, now, ceilingMs) {
  const n = finiteNumber(value);
  if (n === null || n <= now || n > now + ceilingMs) return null;
  return n;
}

/**
 * Thread-safe breaker table with optional persistence.
 *
 * `storage` is any object exposing `read(): string|null` and `write(text): void`.
 * Injecting it keeps this module free of filesystem and DB imports, so the same
 * laws are provable in a unit test without touching disk.
 */
export class PersistentBreakerStore {
  /**
   * @param {object} [options]
   * @param {{read: () => string|null, write: (text: string) => void}|null} [options.storage]
   * @param {number} [options.authCeilingMs]
   */
  constructor({ storage = null, authCeilingMs = BREAKER_AUTH_CEILING_MS } = {}) {
    this.storage = storage;
    this.authCeilingMs = Number.isFinite(authCeilingMs) && authCeilingMs > 0
      ? authCeilingMs
      : BREAKER_AUTH_CEILING_MS;
    /** key -> { failUntil, reason, failedAt } */
    this.data = new Map();
    /** Last write failure, surfaced for diagnostics rather than swallowed. */
    this.lastError = null;
    /** True when memory changed but the write did not land. */
    this.dirty = false;
    if (this.storage) this.load();
  }

  // ── persistence ──────────────────────────────────────────────────────────

  /**
   * Adopt only a wholly valid snapshot. Any structural problem leaves the table
   * empty, because a partially-understood file would keep some rows and drop others.
   */
  load() {
    this.data = new Map();
    if (!this.storage) return this;
    let raw;
    try {
      raw = this.storage.read();
    } catch {
      this.lastError = "read";
      return this;
    }
    if (!raw) return this;

    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      this.lastError = "parse";
      return this;
    }

    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return this;
    if (doc.version !== BREAKER_STORE_VERSION) return this;
    const accounts = doc.accounts;
    if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) return this;
    if (Object.keys(accounts).length > BREAKER_MAX_ACCOUNTS) return this;

    const now = Date.now();
    const restored = new Map();
    for (const [key, row] of Object.entries(accounts)) {
      if (typeof key !== "string" || !key || key.length > 256) return this;
      if (!row || typeof row !== "object" || Array.isArray(row)) return this;
      // A row whose deadline is ABSENT or malformed is a broken document — discard
      // the whole file. A row that is well-formed but already EXPIRED is simply
      // forgotten, which is the point of a deadline. The two must not be conflated:
      // skipping a malformed row would keep some cooldowns and drop others silently.
      const raw = row.failUntil;
      const wellFormed = typeof raw === "number" && Number.isFinite(raw);
      if (!wellFormed) return this;
      const failUntil = validDeadline(raw, now, this.authCeilingMs);
      if (failUntil === null) continue;
      restored.set(key, {
        failUntil,
        reason: safeText(row.reason),
        failedAt: finiteNumber(row.failedAt) ?? 0,
      });
    }
    this.data = restored;
    this.lastError = null;
    this.dirty = false;
    return this;
  }

  /**
   * Serialize, shedding rows nearest expiry until the payload fits the cap.
   * @returns {{text: string|null, shed: boolean}}
   */
  serialize() {
    let entries = [...this.data.entries()];
    let shed = false;
    for (;;) {
      const accounts = Object.fromEntries(entries);
      let text;
      try {
        text = JSON.stringify({ version: BREAKER_STORE_VERSION, accounts });
      } catch {
        return { text: null, shed };
      }
      const bytes = new TextEncoder().encode(text).length;
      if (bytes <= BREAKER_MAX_BYTES || entries.length === 0) return { text, shed };
      // Shed the accounts nearest expiry first, in one proportional step.
      const ordered = entries.slice().sort((a, b) => a[1].failUntil - b[1].failUntil);
      const keep = Math.max(0, Math.floor(ordered.length * (BREAKER_MAX_BYTES / bytes) * 0.9));
      const dropped = ordered.slice(0, Math.max(1, ordered.length - keep));
      const droppedKeys = new Set(dropped.map(([k]) => k));
      entries = entries.filter(([k]) => !droppedKeys.has(k));
      shed = true;
      if (entries.length === 0) {
        return { text: JSON.stringify({ version: BREAKER_STORE_VERSION, accounts: {} }), shed: true };
      }
    }
  }

  /**
   * Rewrite the file atomically.
   * @returns {boolean} false when the update is not fully durable.
   */
  save() {
    if (!this.storage) return true;
    const { text, shed } = this.serialize();
    if (text === null) {
      this.lastError = "serialize";
      this.dirty = true;
      return false;
    }
    try {
      this.storage.write(text);
    } catch (error) {
      this.lastError = error?.name || "write";
      this.dirty = true;
      return false;
    }
    this.lastError = shed ? "capacity" : null;
    this.dirty = shed;
    return !shed;
  }

  // ── use ──────────────────────────────────────────────────────────────────

  /** The deadline this key is parked until, or 0 when admitted. */
  openUntil(key, now = Date.now()) {
    const row = this.data.get(key);
    if (!row) return 0;
    if (row.failUntil <= now) {
      this.data.delete(key);
      return 0;
    }
    return row.failUntil;
  }

  /** Whether a request may pass for this key. */
  admit(key, now = Date.now()) {
    return this.openUntil(key, now) <= now;
  }

  /**
   * Record a failure. Crossing the threshold parks the key until `until`.
   * @returns {boolean} whether the row is durable.
   */
  fail(key, { until, reason = "", now = Date.now() } = {}) {
    const deadline = validDeadline(until, now, this.authCeilingMs);
    if (deadline === null) return true; // nothing to record — not a storage failure
    if (this.data.size >= BREAKER_MAX_ACCOUNTS && !this.data.has(key)) {
      // Bound the table: drop the row nearest expiry to make room.
      const oldest = [...this.data.entries()].sort((a, b) => a[1].failUntil - b[1].failUntil)[0];
      if (oldest) this.data.delete(oldest[0]);
    }
    this.data.set(key, { failUntil: deadline, reason: safeText(reason), failedAt: now });
    return this.save();
  }

  /** Record a success — the key is admitted again immediately. */
  succeed(key) {
    const existed = this.data.delete(key);
    if (!existed && !this.dirty) return true;
    return this.save();
  }

  /** Reset the table (used by tests and by an operator's clear). */
  clear() {
    this.data = new Map();
    return this.save();
  }
}
