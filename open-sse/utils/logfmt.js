// The Keeper's Logbook — shared voice kit for every log line the gateway speaks.
// Pure formatting only: no I/O, no clock reads, no globals — safe for any caller.

/**
 * Duration as a tide reads it: ms under a second, seconds (one decimal) under
 * a minute, then m+ss, then h+mm. 58365 → "58.4s" · 393498 → "6m33s".
 */
export function fmtDur(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 1000) return `${Math.round(v)}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m${String(rs).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Token counts with thousands separators: 76162 → "76,162".
 */
export function fmtTok(n) {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : String(v);
}

// One field value on a log row: arrays read as short lists, objects read as
// compact JSON, long strings are clamped so one field can never flood the ledger.
function fieldStr(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const items = v.slice(0, 3).map((x) => {
      const s = typeof x === "string" ? x : JSON.stringify(x);
      return s.length > 14 ? `${s.slice(0, 11)}…` : s;
    });
    return v.length > 3 ? `${items.join(",")} +${v.length - 3}` : items.join(",");
  }
  let s;
  try { s = typeof v === "string" ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s.length > 96) s = `${s.slice(0, 93)}…`;
  return s;
}

/**
 * Render an options object as an inline ` · key=value` chain (or pass a plain
 * string through untouched). The one shape every structured log row shares.
 */
export function kv(data, sep = " · ") {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data ? `${sep}${data}` : "";
  if (typeof data !== "object") return `${sep}${fieldStr(data)}`;
  const parts = Object.entries(data).map(([k, v]) => `${k}=${fieldStr(v)}`);
  return parts.length ? `${sep}${parts.join(sep)}` : "";
}

// ── The realms — how the logbook names its voices ───────────────────────────
//
// Each uppercase tag belongs to a realm: a banner (the shore a line comes from)
// and a mark (the single glyph that precedes it). Registry entries may be a
// string banner or a {banner, mark} pair; bannerOf always answers a string.
const REALM_STRINGS = {
  CHAT: { banner: "⚓ THE CURRENT", mark: "🧭" },
  COMBO: { banner: "🧭 THE CHARTED ROUTE", mark: "⛵" },
  PROXY: { banner: "🌊 THE PASSAGE", mark: "🔗" },
  TOKEN_REFRESH: { banner: "🔑 THE KEEPER'S KEYS", mark: "🗝️" },
  USAGE: { banner: "🕯️ THE LANTERN", mark: "💡" },
  FETCH: { banner: "📡 THE FAR SHORES", mark: "🌐" },
  IMAGE: { banner: "🎨 THE DREAMING", mark: "🖌️" },
  SEARCH: { banner: "🔭 THE FAR-SEEING", mark: "🔍" },
  TTS: { banner: "🎙️ THE VOICE", mark: "🔊" },
  AUTH: { banner: "🛡️ THE WARD", mark: "⚔️" },
  DB: { banner: "🗂️ THE HARBOUR LEDGER", mark: "📚" },
  STREAM: { banner: "🌊 THE STREAM", mark: "〜" },
};

export const REALMS = Object.freeze(
  Object.fromEntries(
    Object.entries(REALM_STRINGS).map(([tag, realm]) => [tag, Object.freeze(realm)])
  )
);

/** The quiet LOGBOOK realm every unknown tag falls back to. */
export const GENERIC = Object.freeze({ banner: "🕯️ THE LOGBOOK", mark: "•" });

/** The realm a tag belongs to (unknown tags take the quiet LOGBOOK banner). */
export function realmOf(tag) {
  const key = String(tag ?? "").toUpperCase();
  return Object.hasOwn(REALMS, key) ? REALMS[key] : GENERIC;
}

/** The banner line a realm raises: a string, never the registry record. */
export function bannerOf(tag) {
  const realm = realmOf(tag);
  return typeof realm === "string" ? realm : realm.banner;
}

// ── The two voices ──────────────────────────────────────────────────────────
export const LOG_THEMES = Object.freeze({ THEMED: "themed", PLAIN: "plain" });

/** Only the exact word "plain" (any case) is plain; everything else is themed. */
export function normalizeLogTheme(raw) {
  return String(raw ?? "").trim().toLowerCase() === "plain" ? LOG_THEMES.PLAIN : LOG_THEMES.THEMED;
}

// Decoration only: pictographs, arrows, box/symbol blocks, and the joiners that
// hold emoji together. Words, digits and punctuation survive untouched.
const DECORATION =
  /[\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u20E3]|\p{Extended_Pictographic}/gu;

/**
 * Strip the Keeper's decoration from a log line. Words and numbers never move:
 * "⚓ voyage closed in 5.6s · IN 40,625" → "voyage closed in 5.6s · IN 40,625".
 */
export function stripTheme(text) {
  return String(text ?? "")
    .replace(DECORATION, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s·:—\-|]+/, "")
    .trim();
}
