// Logger utility for cloud

import {
  fmtDur,
  fmtTok,
  kv,
  realmOf,
  bannerOf,
  stripTheme,
  normalizeLogTheme,
  LOG_THEMES,
} from "../../../open-sse/utils/logfmt.js";
// M6 §4 — the numeric level is declared AT THE SOURCE. logger.error() has
// always printed through console.log, so the console wrapper's own
// channel→level mapping answered 20 for it and the persisted row read LOG:
// the ERROR→LOG misclassification §0 measured. emitLeveledConsole takes the
// caller's numeric level straight to the write door, and still feeds the live
// ring + SSE through the SAME append the wrapper uses — so the line is one
// ring entry, zero raw lines (M1), one durable row (M3).
//
// The console CHANNEL is unchanged per function, because it is a
// terminal-output choice that predates this tide and other code reads it.
import { emitLeveledConsole } from "../../lib/consoleLogBuffer.js";
import { LOG_LEVELS as LOG_LVL } from "../../lib/logshipper/index.js";

// §1's numeric enum, read from the door itself so the two files cannot drift.
// The names differ from the LOCAL gate below on purpose: this file has always
// owned a `LOG_LEVELS` (its own 0–3 threshold), and shadowing it with the
// door's 10–50 enum would silently re-scale the LOG_LEVEL env gate.
const LVL = {
  debug: LOG_LVL.debug,
  info: LOG_LVL.info,
  warn: LOG_LVL.warn,
  error: LOG_LVL.error,
};

/** One logger line: ring + SSE + durable row + terminal, level from the caller.
 *  Nothing else in the request path is asked to know the severity. */
function emit(channel, lvl, text) {
  emitLeveledConsole({ channel, lvl, text });
}

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase?.()] ?? LOG_LEVELS.INFO;

// ── The logbook's voice ─────────────────────────────────────────────────────
// The theme is a SETTING, but the logger sits on the request path and must
// never await the store to speak a line. The last known voice therefore lives
// here in memory; `refreshLogTheme()` reads it at most once per 5s, and a
// failed read leaves the last voice standing. Fail-open is the law.
let _logTheme = normalizeLogTheme(process.env.VELA_LOG_THEME);
const THEME_REFRESH_MS = 5_000;
let _lastThemeReadAt = 0;

/** Read back the voice in force (always a normalized value). */
export function getLogTheme() {
  return _logTheme;
}

/** Pin the voice. Returns the NORMALIZED value the switch actually took. */
export function setLogTheme(raw) {
  _logTheme = normalizeLogTheme(raw);
  return _logTheme;
}

/**
 * Read the stored voice and flip the tongue. Throttled to once per 5s unless
 * `force` (the TTL is measured against the last READ, not the last change).
 * A throwing or unreadable store never wedges the voice — it keeps speaking.
 */
export async function refreshLogTheme({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - _lastThemeReadAt < THEME_REFRESH_MS) return _logTheme;
  _lastThemeReadAt = now;
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const stored = settings?.logTheme;
    if (stored !== undefined && stored !== null && String(stored).trim() !== "") {
      _logTheme = normalizeLogTheme(stored);
    }
  } catch {
    // fail-open: the last voice stands
  }
  return _logTheme;
}

/** A glyph, spoken only when the tongue is themed. */
function voice(glyph) {
  return _logTheme === LOG_THEMES.PLAIN ? "" : glyph;
}

/** A realm line, dressed in the voice in force: "[mark TAG] message". */
function dress(tag, message, data) {
  const body = `${message}${kv(data)}`;
  if (_logTheme === LOG_THEMES.PLAIN) return `[${stripTheme(tag)}] ${stripTheme(body)}`;
  return `[${voice(realmOf(tag).mark)}${voice(realmOf(tag).mark) ? " " : ""}${tag}] ${body}`;
}

/** The realm's banner, through the same funnel as every other line. */
export function banner(tag, message) {
  const head = _logTheme === LOG_THEMES.PLAIN ? stripTheme(bannerOf(tag)) : bannerOf(tag);
  const body = _logTheme === LOG_THEMES.PLAIN ? stripTheme(message) : String(message ?? "");
  emit("log", LVL.info, `[${formatTime()}] ${head} ${body}`);
}


function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// Colored-dot tags to correlate request lines by session (same session → same color)
const REQ_TAGS = ["🟢", "🔵", "🟣", "🟡", "🟠", "🔴", "⚪", "🟤"];
let tagCursor = 0;

// Allocate next rotating tag (fallback when no session seed available)
export function nextTag() {
  const tag = REQ_TAGS[tagCursor % REQ_TAGS.length];
  tagCursor++;
  return tag;
}

// Stable tag derived from a session/connection seed: same seed always maps to the same color
export function tagForSession(seed) {
  if (!seed) return nextTag();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return REQ_TAGS[Math.abs(h) % REQ_TAGS.length];
}

// Print one correlated line: [time] tag symbol message
export function line(tag, symbol, message) {
  if (LEVEL > LOG_LEVELS.INFO) return;
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

// Like line() but always printed regardless of LOG_LEVEL (errors must never be hidden)
export function errorLine(tag, symbol, message) {
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

// Format thinking intent for the request line ("high(10k)" / "off" / "auto")
export function fmtThink(intent) {
  if (!intent || !intent.mode) return null;
  if (intent.mode === "none") return "off";
  if (intent.mode === "auto") return "auto";
  if (intent.mode === "budget") {
    const k = intent.budget >= 1000 ? `${Math.round(intent.budget / 1000)}k` : `${intent.budget}`;
    return k;
  }
  if (intent.mode === "level") return intent.level;
  return null;
}


// M6 §4 — each of the four declares its own numeric level at the source. The
// text, the icon, the tag and the console channel are all EXACTLY as they were
// (a line copied out of the terminal is byte-identical to v1.0.59's); only the
// path to the ledger changed, so the persisted row no longer needs a text
// classifier to recover a severity it already knows.
export function debug(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    emit("log", LVL.debug, `[${formatTime()}] ${voice("🔍")} ${dress(tag, message, data)}`);
  }
}

export function info(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    emit("log", LVL.info, `[${formatTime()}] ${voice("ℹ️")} ${dress(tag, message, data)}`);
  }
}

export function warn(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.WARN) {
    emit("warn", LVL.warn, `[${formatTime()}] ${voice("⚠️")} ${dress(tag, message, data)}`);
  }
}

export function error(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    emit("log", LVL.error, `[${formatTime()}] ${voice("❌")} ${dress(tag, message, data)}`);
  }
}


export function request(method, path, extra) {
  console.log(`\x1b[36m[${formatTime()}] 📥 arrive ${method} ${path}${kv(extra)}\x1b[0m`);
}

export function response(status, duration, extra) {
  const icon = status < 400 ? "📤" : "💥";
  console.log(`[${formatTime()}] ${icon} ${status} · ${fmtDur(duration)}${kv(extra)}`);
}

export function stream(event, data) {
  const line = `[${formatTime()}] ${voice("🌊") !== "" ? "🌊 " : ""}[STREAM] ${event}${kv(data)}`;
  console.log(_logTheme === LOG_THEMES.PLAIN ? stripTheme(line) : line);
}

// Mask sensitive data
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
