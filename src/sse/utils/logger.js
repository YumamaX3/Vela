// Logger utility for cloud

import { fmtDur, fmtTok, kv } from "open-sse/utils/logfmt.js";
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
import { emitLeveledConsole } from "@/lib/consoleLogBuffer.js";
import { LOG_LEVELS as LOG_LVL } from "@/lib/logshipper/index.js";

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
    emit("log", LVL.debug, `[${formatTime()}] 🔍 [${tag}] ${message}${kv(data)}`);
  }
}

export function info(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    emit("log", LVL.info, `[${formatTime()}] ℹ️  [${tag}] ${message}${kv(data)}`);
  }
}

export function warn(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.WARN) {
    emit("warn", LVL.warn, `[${formatTime()}] ⚠️  [${tag}] ${message}${kv(data)}`);
  }
}

export function error(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    emit("log", LVL.error, `[${formatTime()}] ❌ [${tag}] ${message}${kv(data)}`);
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
  console.log(`[${formatTime()}] 🌊 [STREAM] ${event}${kv(data)}`);
}

// Mask sensitive data
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
