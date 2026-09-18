import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    entries: [], // Structured log entries
    seq: 0,
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(100);
}

const state = global._consoleLogBufferState;

if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(100);
}

if (!state.entries) state.entries = [];
if (state.seq === undefined) state.seq = 0;
if (!state.pendingLines) state.pendingLines = [];
if (!state.pendingEntries) state.pendingEntries = [];
if (!state.flushTimer) state.flushTimer = null;

const FLUSH_INTERVAL_MS = 80;
const MAX_BATCH_LINES = 50;

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  const entries = state.pendingEntries ? state.pendingEntries.splice(0, state.pendingEntries.length) : [];
  state.emitter.emit("lines", lines);
  if (entries.length) {
    state.emitter.emit("entries", entries);
  }
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

// HH:MM:SS in the server's local format
function timeStamp(date = new Date()) {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

// Strip ANSI escape codes
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return typeof str === "string" ? str.replace(ANSI_RE, "") : String(str);
}

function formatArg(arg) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

// Extract tags like [FETCH], [AUTH], [RTK], [STREAM], [DB], etc.
const TAG_RE = /\[([A-Za-z0-9_-]{2,24})\]/g;

function extractTags(text) {
  const tags = new Set();
  let match;
  while ((match = TAG_RE.exec(text)) !== null) {
    const candidate = match[1].toUpperCase();
    if (!["LOG", "INFO", "WARN", "ERROR", "DEBUG"].includes(candidate)) {
      tags.add(candidate);
    }
  }
  return Array.from(tags);
}

function buildEntry(level, args, now) {
  state.seq = (state.seq + 1) % 1_000_000_000;
  const time = timeStamp(now);
  const lvlUpper = level.toUpperCase();
  const message = args.map(formatArg).join(" ");
  const raw = `${time} [${lvlUpper}] ${message}`;

  return {
    id: `log_${state.seq}_${now.getTime()}`,
    seq: state.seq,
    time,
    iso: now.toISOString(),
    level: lvlUpper,
    message,
    raw,
    tags: extractTags(message),
  };
}

function appendLine(level, args) {
  const entry = buildEntry(level, args, new Date());

  state.logs.push(entry.raw);
  state.entries.push(entry);

  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }
  if (state.entries.length > maxLines) {
    state.entries = state.entries.slice(-maxLines);
  }

  state.pendingLines.push(entry.raw);
  state.pendingEntries.push(entry);

  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(level, args);
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs({ level = "all", query = "", tag = "all", limit = null, structured = false } = {}) {
  if (structured) {
    let res = state.entries;
    if (level && level !== "all") {
      const targetLvl = level.toUpperCase();
      res = res.filter((e) => e.level === targetLvl);
    }
    if (tag && tag !== "all") {
      const targetTag = tag.toUpperCase();
      res = res.filter((e) => e.tags.includes(targetTag));
    }
    if (query) {
      const q = query.toLowerCase();
      res = res.filter((e) => e.message.toLowerCase().includes(q) || e.time.includes(q));
    }
    if (limit && Number.isInteger(limit) && limit > 0) {
      res = res.slice(-limit);
    }
    return res;
  }

  // Raw string logs query
  let res = state.logs;
  if (level && level !== "all") {
    const targetLvl = `[${level.toUpperCase()}]`;
    res = res.filter((l) => l.includes(targetLvl));
  }
  if (tag && tag !== "all") {
    const targetTag = `[${tag.toUpperCase()}]`;
    res = res.filter((l) => l.toUpperCase().includes(targetTag));
  }
  if (query) {
    const q = query.toLowerCase();
    res = res.filter((l) => l.toLowerCase().includes(q));
  }
  if (limit && Number.isInteger(limit) && limit > 0) {
    res = res.slice(-limit);
  }
  return res;
}

export function getConsoleLogStats() {
  const counts = { total: state.entries.length, LOG: 0, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
  const tagCounts = {};
  for (const e of state.entries) {
    if (counts[e.level] !== undefined) counts[e.level]++;
    for (const t of e.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  return {
    counts,
    tagCounts,
    maxLines: CONSOLE_LOG_CONFIG.maxLines,
  };
}

export function clearConsoleLogs() {
  state.logs = [];
  state.entries = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
